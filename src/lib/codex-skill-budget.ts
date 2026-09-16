// Measures how much of Codex's skills context budget the installed skill
// descriptions consume, grouped by the source that supplies them.
//
// Verified on codex-cli 0.154.0 (2026-09-16): the skills list budget is 2% of
// the model context window (10,000 tokens for gpt-6-astra, 8,000 characters
// when the window is unknown). `[skills] max_context_tokens` can only lower
// that cap, never raise it — a configured 16000 or 64000 still logs
// `budget_limit=10000`. When the list overflows, Codex trims the longest
// descriptions first (`truncated_description_chars_per_skill`) and, for very
// large sets, omits skills entirely. The only remedies that widen headroom are
// disabling plugins or individual skills, or shortening descriptions.
//
// This module never edits `config.toml`; it reads it to learn which plugins are
// enabled and reports what each source costs so the user can decide.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { codexInstallPaths } from "./codex-install-state.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { isPlainObject } from "./merge-keyed.ts";

/** 2% of a 500K window; the cap Codex applies for gpt-6-astra. */
export const DEFAULT_CODEX_SKILL_BUDGET_TOKENS = 10_000;

/** Codex's own accounting, back-solved from `budget_limit` versus measured chars. */
const CHARS_PER_TOKEN = 4;

/** Rough per-entry cost of the name and source locator Codex renders beside each description. */
const LISTING_OVERHEAD_CHARS = 48;

const MAX_WALK_DEPTH = 6;

export interface CodexSkillEntry {
  name: string;
  path: string;
  source: string;
  descriptionChars: number;
}

export interface CodexSkillSource {
  /** `plugin darkroom@cc-settings`, `user ~/.codex/skills`, `codex built-in`, ... */
  label: string;
  /** TOML plugin id (`name@marketplace`) when the source is a plugin; used for the disable snippet. */
  pluginId?: string;
  skills: number;
  descriptionChars: number;
}

export interface CodexSkillBudgetReport {
  configPath: string;
  budgetTokens: number;
  configuredMaxContextTokens?: number;
  sources: CodexSkillSource[];
  entries: CodexSkillEntry[];
  totalSkills: number;
  descriptionChars: number;
  /** Descriptions plus estimated listing overhead, in characters. */
  listingChars: number;
  /** `listingChars / 4`, labelled est. in the report. */
  estimatedTokens: number;
  overBudget: boolean;
  /** Positive when over: estimated characters that must be trimmed or removed. */
  overshootChars: number;
  disabledPlugins: string[];
  /** `SKILL.md` paths excluded because `[[skills.config]]` disables them. */
  disabledSkills: string[];
}

interface PluginRef {
  id: string;
  name: string;
  marketplace: string;
}

interface CodexConfigView {
  enabledPlugins: PluginRef[];
  disabledPlugins: string[];
  /** Resolved `SKILL.md` paths hidden through `[[skills.config]] enabled = false`. */
  disabledSkillPaths: Set<string>;
  marketplaceSources: Map<string, string>;
  maxContextTokens?: number;
}

function readConfigView(parsed: unknown): CodexConfigView {
  const view: CodexConfigView = {
    enabledPlugins: [],
    disabledPlugins: [],
    disabledSkillPaths: new Set(),
    marketplaceSources: new Map(),
  };
  if (!isPlainObject(parsed)) return view;
  const plugins = parsed.plugins;
  if (isPlainObject(plugins)) {
    for (const [id, entry] of Object.entries(plugins)) {
      const at = id.lastIndexOf("@");
      if (at <= 0) continue;
      const enabled = isPlainObject(entry) ? entry.enabled !== false : true;
      if (!enabled) {
        view.disabledPlugins.push(id);
        continue;
      }
      view.enabledPlugins.push({ id, name: id.slice(0, at), marketplace: id.slice(at + 1) });
    }
  }
  const marketplaces = parsed.marketplaces;
  if (isPlainObject(marketplaces)) {
    for (const [name, entry] of Object.entries(marketplaces)) {
      if (isPlainObject(entry) && typeof entry.source === "string") {
        view.marketplaceSources.set(name, entry.source);
      }
    }
  }
  const skills = parsed.skills;
  if (isPlainObject(skills)) {
    if (typeof skills.max_context_tokens === "number") {
      view.maxContextTokens = skills.max_context_tokens;
    }
    // `[[skills.config]]` entries with `enabled = false` hide one skill each.
    if (Array.isArray(skills.config)) {
      for (const entry of skills.config) {
        if (isPlainObject(entry) && entry.enabled === false && typeof entry.path === "string") {
          view.disabledSkillPaths.add(resolve(entry.path));
        }
      }
    }
  }
  return view;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const ALWAYS_SKIPPED_DIRS = new Set([".tmp", "node_modules"]);

/**
 * Every `SKILL.md` at or below `root`, stopping at each skill directory.
 * `skip` names child directories to leave out at every depth (for example
 * `.system`, which is reported as its own source).
 */
export async function findSkillFiles(
  root: string,
  skip: ReadonlySet<string> = new Set(),
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_WALK_DEPTH || !(await isDirectory(root))) return [];
  if (existsSync(join(root, "SKILL.md"))) return [join(root, "SKILL.md")];
  const found: string[] = [];
  let names: string[];
  try {
    names = (await readdir(root)).sort();
  } catch {
    return found;
  }
  for (const name of names) {
    if (ALWAYS_SKIPPED_DIRS.has(name) || skip.has(name)) continue;
    found.push(...(await findSkillFiles(join(root, name), skip, depth + 1)));
  }
  return found;
}

/** Numeric-aware version order so `1.10.0` sorts after `1.9.0`. */
export function compareVersionDirs(a: string, b: string): number {
  const partsA = a
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  const partsB = b
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

/** The `description:` Codex renders for one skill, or an empty string when absent. */
export async function readSkillDescription(
  skillPath: string,
): Promise<{ name: string; description: string }> {
  const fallbackName = skillPath.split(sep).at(-2) ?? skillPath;
  let raw: string;
  try {
    raw = await readFile(skillPath, "utf8");
  } catch {
    return { name: fallbackName, description: "" };
  }
  const data = parseFrontmatter(raw);
  if (!isPlainObject(data)) return { name: fallbackName, description: "" };
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
  const description = typeof data.description === "string" ? data.description.trim() : "";
  return { name, description };
}

/** Newest installed version directory of a cached plugin, or the marketplace source fallback. */
async function resolvePluginDir(
  codexHome: string,
  plugin: PluginRef,
  marketplaceSources: Map<string, string>,
): Promise<string | null> {
  const cache = join(codexHome, "plugins", "cache", plugin.marketplace, plugin.name);
  if (await isDirectory(cache)) {
    if (existsSync(join(cache, "skills"))) return cache;
    const versions: string[] = [];
    for (const entry of await readdir(cache)) {
      if (await isDirectory(join(cache, entry))) versions.push(entry);
    }
    if (versions.length) return join(cache, versions.sort(compareVersionDirs).at(-1) as string);
  }
  const marketplace = marketplaceSources.get(plugin.marketplace);
  if (marketplace) {
    for (const candidate of [
      join(marketplace, plugin.name),
      join(marketplace, "plugins", plugin.name),
    ]) {
      if (await isDirectory(candidate)) return candidate;
    }
  }
  return null;
}

export interface MeasureOptions {
  home?: string;
  budgetTokens?: number;
}

export async function measureCodexSkillBudget(
  options: MeasureOptions = {},
): Promise<CodexSkillBudgetReport> {
  const paths = codexInstallPaths(options.home);
  let view = readConfigView(null);
  try {
    view = readConfigView(Bun.TOML.parse(await readFile(paths.configPath, "utf8")));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Cannot parse Codex TOML config ${paths.configPath}`, { cause });
    }
  }

  const sources: CodexSkillSource[] = [];
  const entries: CodexSkillEntry[] = [];

  const disabledSkills: string[] = [];
  const addSource = async (
    label: string,
    roots: string[],
    pluginId?: string,
    skip?: ReadonlySet<string>,
  ) => {
    const source: CodexSkillSource = { label, pluginId, skills: 0, descriptionChars: 0 };
    for (const root of roots) {
      for (const skillPath of await findSkillFiles(root, skip)) {
        if (view.disabledSkillPaths.has(resolve(skillPath))) {
          disabledSkills.push(skillPath);
          continue;
        }
        const { name, description } = await readSkillDescription(skillPath);
        source.skills += 1;
        source.descriptionChars += description.length;
        entries.push({
          name,
          path: skillPath,
          source: label,
          descriptionChars: description.length,
        });
      }
    }
    sources.push(source);
  };

  const userSkills = join(paths.codexHome, "skills");
  await addSource("user $CODEX_HOME/skills", [userSkills], undefined, new Set([".system"]));
  await addSource("codex built-in (.system)", [join(userSkills, ".system")]);
  await addSource("user ~/.agents/skills", [join(paths.homeDir, ".agents", "skills")]);
  for (const plugin of view.enabledPlugins) {
    const dir = await resolvePluginDir(paths.codexHome, plugin, view.marketplaceSources);
    await addSource(`plugin ${plugin.id}`, dir ? [join(dir, "skills")] : [], plugin.id);
  }

  const descriptionChars = sources.reduce((sum, source) => sum + source.descriptionChars, 0);
  const totalSkills = sources.reduce((sum, source) => sum + source.skills, 0);
  const listingChars = descriptionChars + totalSkills * LISTING_OVERHEAD_CHARS;
  const estimatedTokens = Math.ceil(listingChars / CHARS_PER_TOKEN);
  const requested = options.budgetTokens ?? DEFAULT_CODEX_SKILL_BUDGET_TOKENS;
  const budgetTokens =
    view.maxContextTokens !== undefined && view.maxContextTokens < requested
      ? view.maxContextTokens
      : requested;
  const overshootChars = Math.max(0, listingChars - budgetTokens * CHARS_PER_TOKEN);

  return {
    configPath: paths.configPath,
    budgetTokens,
    configuredMaxContextTokens: view.maxContextTokens,
    sources: sources
      .filter((source) => source.skills > 0)
      .sort((a, b) => b.descriptionChars - a.descriptionChars),
    entries: entries.sort((a, b) => b.descriptionChars - a.descriptionChars),
    totalSkills,
    descriptionChars,
    listingChars,
    estimatedTokens,
    overBudget: overshootChars > 0,
    overshootChars,
    disabledPlugins: view.disabledPlugins.sort(),
    disabledSkills: disabledSkills.sort(),
  };
}

function shortPath(path: string, home: string): string {
  const rel = relative(home, path);
  return rel.startsWith("..") ? path : `~/${rel.split(sep).join("/")}`;
}

export function formatCodexSkillBudget(
  report: CodexSkillBudgetReport,
  home: string,
  longest = 10,
): string {
  const lines: string[] = [];
  const pad = (value: number | string, width: number) => String(value).padStart(width);
  lines.push("Codex skills context budget");
  lines.push(`config: ${shortPath(report.configPath, home)}`);
  lines.push("");
  lines.push(`${pad("chars", 7)} ${pad("est.tok", 8)} ${pad("skills", 6)}  source`);
  for (const source of report.sources) {
    lines.push(
      `${pad(source.descriptionChars, 7)} ${pad(Math.ceil(source.descriptionChars / CHARS_PER_TOKEN), 8)} ${pad(source.skills, 6)}  ${source.label}`,
    );
  }
  lines.push(
    `${pad(report.descriptionChars, 7)} ${pad(Math.ceil(report.descriptionChars / CHARS_PER_TOKEN), 8)} ${pad(report.totalSkills, 6)}  TOTAL descriptions`,
  );
  lines.push(
    `${pad(report.listingChars, 7)} ${pad(report.estimatedTokens, 8)} ${pad("", 6)}  TOTAL with listing overhead (est.)`,
  );
  lines.push("");
  const configured =
    report.configuredMaxContextTokens === undefined
      ? "not set"
      : `${report.configuredMaxContextTokens} (only lowers the cap; never raises it)`;
  lines.push(
    `budget: ${report.budgetTokens} tokens (~${report.budgetTokens * CHARS_PER_TOKEN} chars); [skills] max_context_tokens: ${configured}`,
  );
  if (report.overBudget) {
    lines.push(
      `verdict: OVER by ~${report.overshootChars} chars (est.). Codex will shorten the longest descriptions; disable a plugin or skills worth at least that much.`,
    );
  } else {
    lines.push(
      `verdict: under budget with ~${report.budgetTokens * CHARS_PER_TOKEN - report.listingChars} chars headroom (est.).`,
    );
  }
  if (report.disabledPlugins.length)
    lines.push(`disabled plugins: ${report.disabledPlugins.join(", ")}`);
  if (report.disabledSkills.length) {
    lines.push(`disabled skills ([[skills.config]]): ${report.disabledSkills.length}`);
  }
  lines.push("");
  lines.push(
    `longest ${Math.min(longest, report.entries.length)} descriptions (these are trimmed first):`,
  );
  for (const entry of report.entries.slice(0, longest)) {
    lines.push(`${pad(entry.descriptionChars, 7)}  ${entry.name}  ${shortPath(entry.path, home)}`);
  }
  if (report.overBudget) {
    const candidates = report.sources.filter(
      (source) =>
        source.pluginId &&
        source.pluginId !== "darkroom@cc-settings" &&
        source.descriptionChars >= report.overshootChars,
    );
    lines.push("");
    lines.push("any one of these plugins covers the overshoot when disabled in config.toml:");
    for (const source of candidates.slice(0, 5)) {
      lines.push(`  [plugins."${source.pluginId}"]  # frees ~${source.descriptionChars} chars`);
      lines.push("  enabled = false");
    }
    lines.push("or hide single skills:");
    lines.push("  [[skills.config]]");
    lines.push('  path = "/path/to/skill/SKILL.md"');
    lines.push("  enabled = false");
  }
  lines.push("");
  lines.push("authoritative numbers from Codex itself:");
  lines.push(
    '  RUST_LOG=codex_skills_extension::render_observability=info codex exec --skip-git-repo-check "Reply OK" 2>&1 | grep budget_limit',
  );
  return lines.join("\n");
}
