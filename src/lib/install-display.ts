// Install display helpers — extracted from src/setup.ts (§1.1).
//
// Pure output rendering: countEntries, showSummary, cmdDryRun, printStatus.
// No coupling to install execution; import them from setup.ts's install phases.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { boxEnd, boxLine, boxStart, palette, success, warn } from "./colors.ts";
import { readJsonOrNull } from "./json-io.ts";
import { LIGHT_SKILLS, PROFILE_MANIFEST } from "./light-profile.ts";
import { ACTIVE_SKILLS } from "./managed-skills.ts";
import { CLAUDE_JSON_PATH } from "./mcp.ts";
import { CLAUDE_DIR } from "./platform.ts";
import type { StatusData } from "./status-types.ts";

// The count helpers take an absolute directory so they're pure and unit-testable
// against a temp dir (CLAUDE_DIR is fixed at import, so callers join it in).

/** Count immediate entries of `full` whose name matches `pattern`. */
export async function countEntries(full: string, pattern: RegExp): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full);
    return entries.filter((e) => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

/**
 * Count skills cc-settings installed. Unlike the other manifest dirs (flat
 * `*.md` files), skills are subdirectories each holding a `SKILL.md`, so a
 * `/\.md$/` match on the top level only ever finds `README.md` and reports 1.
 *
 * Restricted to ACTIVE_SKILLS because ~/.claude/skills/ is shared: plugin and
 * third-party skills live there too and are deliberately left alone by the
 * installer. Counting every subdir made the summary claim credit for those —
 * a box reading "skills/ (41)" under the heading "Installed" when cc-settings
 * had installed 39. Tombstones are excluded for the same reason from the other
 * direction: MANAGED_SKILLS includes retired names the installer DELETES, and
 * counting a directory it just removed would be worse than counting one it
 * never wrote.
 */
export async function countSkillDirs(full: string): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const active = new Set<string>(ACTIVE_SKILLS);
    const entries = await readdir(full, { withFileTypes: true });
    return entries.filter(
      (e) => e.isDirectory() && active.has(e.name) && existsSync(join(full, e.name, "SKILL.md")),
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Count entries matching `pattern` anywhere under `full`. `docs/` keeps some
 * files in subdirs (plans/, upstream-bugs/, …) that the installer copies
 * recursively, so a top-level-only count undercounts what lands in ~/.claude.
 */
export async function countEntriesRecursive(full: string, pattern: RegExp): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full, { recursive: true });
    return entries.filter((e) => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

export async function showSummary(
  profile: "full" | "light",
  sourceDir?: string,
  mcpOverridden: readonly string[] = [],
): Promise<void> {
  const profileLabel = profile === "light" ? " [light]" : "";
  console.log("");
  boxStart(`Installed${profileLabel}`);
  if (profile === "light") {
    boxLine("ok", "settings.json ($schema + statusLine only)");
    for (const skill of LIGHT_SKILLS) boxLine("ok", `skills/${skill}`);
    boxLine("ok", "src/      (TS; statusLine + libs)");
    boxLine("ok", "memory/");
  } else {
    // Rendered from PROFILE_MANIFEST so the summary can't drift from what
    // installConfigFiles actually copies. Dirs with installed .md files show
    // a count; container dirs (skills/) just list.
    const ROOT_FILE_LABELS: Record<string, string> = {
      "CLAUDE.md": "(Claude-Code config)",
      "AGENTS.md": "(portable standards)",
    };
    const manifest = PROFILE_MANIFEST.full;
    for (const [, dest] of manifest.rootFiles) {
      const label = ROOT_FILE_LABELS[dest];
      boxLine("ok", label ? `${dest} ${label}` : dest);
    }
    boxLine("ok", "settings.json (TS hooks)");
    boxLine("ok", "~/.claude.json (MCP servers)");
    const counts = await Promise.all(
      manifest.dirs.map((d) => {
        const full = join(CLAUDE_DIR, d);
        if (d === "skills") return countSkillDirs(full);
        if (d === "docs") return countEntriesRecursive(full, /\.md$/);
        return countEntries(full, /\.md$/);
      }),
    );
    manifest.dirs.forEach((d, i) => {
      const n = counts[i] ?? 0;
      boxLine("ok", n > 0 ? `${d}/ (${n})` : `${d}/`);
    });
    boxLine("ok", "src/      (TS; hooks + scripts + libs + schemas)");
    boxLine("ok", "memory/");
  }
  boxEnd();

  if (profile === "light") {
    console.log("");
    console.log(
      `${palette.dim}Light profile: raw Claude Code · statusLine · share-learning skill only${palette.reset}`,
    );
    console.log(
      `${palette.dim}No CLAUDE.md, AGENTS.md, MCP servers, hooks, or effort override.${palette.reset}`,
    );
    console.log(`${palette.dim}Re-run without --light to upgrade to full.${palette.reset}`);
  }

  const claudeJson = (await readJsonOrNull(CLAUDE_JSON_PATH)) as {
    mcpServers?: Record<string, unknown>;
  } | null;
  const installed = Object.keys(claudeJson?.mcpServers ?? {});
  if (installed.length > 0) {
    console.log("");
    console.log(`${palette.bold}MCP servers in ~/.claude.json:${palette.reset}`);
    // Classified against what cc-settings actually ships (config/20-mcp.json),
    // NOT against a `_status` key on the installed entry. The composer strips
    // `_status`/`_comment` to keep settings.json schema-clean, so no server we
    // write carries one — reading it back only ever found residue from a
    // pre-strip install, which left every currently-shipped server (tldr,
    // context7) mislabelled as "user-added".
    const shipped = profile === "light" ? new Set<string>() : await readShippedMcpNames(sourceDir);
    const { managed, userAdded } = classifyMcpServers(installed, shipped);
    const overridden = new Set(mcpOverridden);
    if (managed.length > 0) {
      console.log(`  ${palette.dim}cc-settings:${palette.reset}`);
      // Shipping a server and running our definition of it are different facts.
      // Marking the gap is what makes a stale local copy visible instead of
      // silently outliving install after install.
      for (const s of managed) {
        console.log(
          overridden.has(s)
            ? `    - ${s} ${palette.dim}(your copy is in use — cc-settings' version not applied)${palette.reset}`
            : `    - ${s}`,
        );
      }
    }
    if (userAdded.length > 0) {
      console.log(`  ${palette.dim}user-added:${palette.reset}`);
      for (const s of userAdded) console.log(`    - ${s}`);
    }
    if (shouldHintContext7(managed, overridden)) {
      console.log("");
      console.log(
        `  ${palette.dim}context7 is running keyless (lower rate limits).${palette.reset}`,
      );
      console.log(
        `  ${palette.dim}Higher limits + private repos:${palette.reset} bunx ctx7 setup --claude --mcp`,
      );
      console.log(`  ${palette.dim}Free key: context7.com/dashboard${palette.reset}`);
    }
  }
}

/**
 * Names of the MCP servers cc-settings ships, read from the source fragment the
 * installer composes into settings.json. This is the only authority on "ours vs
 * theirs" — the installed entries carry no marker of their own.
 *
 * Returns an empty set when `sourceDir` is unknown or the fragment is missing,
 * which degrades to listing everything as user-added rather than guessing.
 */
export async function readShippedMcpNames(sourceDir?: string): Promise<Set<string>> {
  if (!sourceDir) return new Set();
  const fragment = (await readJsonOrNull(join(sourceDir, "config", "20-mcp.json"))) as {
    mcpServers?: Record<string, unknown>;
  } | null;
  return new Set(Object.keys(fragment?.mcpServers ?? {}));
}

/**
 * Whether to nudge the user toward a context7 API key.
 *
 * cc-settings ships context7 as the keyless stdio transport, which context7
 * documents as the lower tier ("higher rate limits and private repositories"
 * come with a free key). Nothing else tells anyone the better tier exists, so
 * without this every install silently sits on the worse one.
 *
 * True only when OUR entry is the one actually running: context7 is a managed
 * server AND the user hasn't shadowed it with their own definition. On the
 * light profile `managed` is empty, so it stays silent with no special case.
 *
 * Deliberately narrower than "has no API key". Any user-supplied context7 entry
 * silences this, including a hand-written keyless one — we do not inspect the
 * entry for auth markers, because the auth shape is context7's to define (their
 * README documents `Authorization: Bearer`; a real config in the wild used a
 * `CONTEXT7_API_KEY` header) and sniffing for it would make us the third party
 * guessing at a contract we don't own. The target is the default nobody chose,
 * not every keyless setup: someone who wrote their own entry has already
 * thought about context7 and doesn't need the nudge.
 *
 * Pure so it can be unit-tested without a TTY or a filesystem — same discipline
 * as `decideAutoUpdate`. cc-settings never reads, writes, or prints a key; the
 * hint points at `ctx7 setup`, which owns the OAuth and the auth contract.
 */
export function shouldHintContext7(
  managed: readonly string[],
  overridden: ReadonlySet<string>,
): boolean {
  return managed.includes("context7") && !overridden.has("context7");
}

/** Split installed server names into cc-settings-managed and user-added. */
export function classifyMcpServers(
  installed: readonly string[],
  shipped: ReadonlySet<string>,
): { managed: string[]; userAdded: string[] } {
  const managed: string[] = [];
  const userAdded: string[] = [];
  for (const name of installed) {
    if (shipped.has(name)) managed.push(name);
    else userAdded.push(name);
  }
  return { managed, userAdded };
}

export async function cmdDryRun(
  source: string,
  profile: "full" | "light",
  version: string,
): Promise<void> {
  const profileLabel = profile === "light" ? " [light profile]" : "";
  console.log(`cc-settings installer v${version} — dry-run${profileLabel}`);
  console.log(`source: ${source}`);
  console.log(`target: ${CLAUDE_DIR}`);
  console.log("");

  if (profile === "light") {
    console.log("Would install (light = raw Claude Code + statusLine + share-learning):");
    const items: Array<[string, string]> = [
      ...LIGHT_SKILLS.map((s): [string, string] => [`skills/${s}/`, `→ ~/.claude/skills/${s}/`]),
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ["config/", "→ ~/.claude/settings.json ($schema + statusLine only)"],
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(28)} ${effect}`);
    }
    console.log("");
    console.log("Light profile: no CLAUDE.md · no AGENTS.md · no MCP servers · no hooks");
    console.log("               no agents · no rules · no profiles · no docs");
    console.log("               default Claude Code permissions · default effort");
  } else {
    console.log("Would install:");
    // Rendered from PROFILE_MANIFEST so the dry-run table can't drift from
    // what installConfigFiles actually copies.
    const items: Array<[string, string]> = [
      ...PROFILE_MANIFEST.full.rootFiles.map(([src, dest]): [string, string] => [
        src,
        `→ ~/.claude/${dest}`,
      ]),
      ["config/", "→ ~/.claude/settings.json (composed); MCP block → ~/.claude.json"],
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ...PROFILE_MANIFEST.full.dirs.map((d): [string, string] => [`${d}/`, `→ ~/.claude/${d}/`]),
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(22)} ${effect}`);
    }
  }

  console.log("");
  console.log("No files written. Re-run without --dry-run to install.");
}

export function printStatus(data: StatusData): void {
  console.log("cc-settings --status");
  console.log("");

  // Installed version
  if (data.sentinel.version) {
    const profileLabel = data.sentinel.profile ? ` [${data.sentinel.profile}]` : "";
    console.log(
      `  installed: v${data.sentinel.version}${profileLabel}  (${data.sentinel.installedAt ?? "unknown"})`,
    );
  } else {
    console.log(
      `  installed: ${palette.yellow}none${palette.reset}  (no sentinel at ~/.claude/.cc-settings-version)`,
    );
  }
  console.log(`  packaged:  v${data.packagedVersion}`);

  // Git drift
  if (data.git?.sha) {
    const g = data.git;
    const driftNote =
      g.behind === null
        ? "(sentinel absent — can't compute drift)"
        : g.behind === 0
          ? `${palette.green}up to date${palette.reset}`
          : `${palette.yellow}${g.behind} commit(s) since install${palette.reset}`;
    console.log(`  repo HEAD: ${g.sha}  ${driftNote}`);
  }

  console.log("");
  console.log("Managed skills:");
  console.log(`  present: ${data.skills.presentCount}/${data.skills.shippedCount}`);
  if (data.skills.missing.length > 0) {
    console.log(`  missing: ${data.skills.missing.join(", ")}`);
  }

  console.log("");
  console.log("Hooks:");
  console.log(
    `  events registered: ${data.hooks.events.length}  (${data.hooks.groupCount} group(s) total)`,
  );
  if (data.hooks.events.length > 0) {
    console.log(`  ${data.hooks.events.sort().join(", ")}`);
  }

  console.log("");
  console.log("Env vars:");
  for (const { key, value } of data.envVars) {
    const mark =
      value === undefined
        ? `${palette.yellow}✗${palette.reset}`
        : `${palette.green}✓${palette.reset}`;
    const val = value === undefined ? "(unset)" : value;
    console.log(`  ${mark} ${key}=${val}`);
  }

  console.log("");
  console.log("Permissions:");
  console.log(`  allow: ${data.permissions.allowCount}  deny: ${data.permissions.denyCount}`);

  console.log("");
  console.log("MCP servers:");
  const { servers } = data.mcp;
  console.log(
    `  configured: ${servers.length}${servers.length > 0 ? `  (${servers.join(", ")})` : ""}`,
  );

  if (data.autoUpdate) {
    const { enrolled, plistPresent, lastRun } = data.autoUpdate;
    console.log("");
    console.log("Auto-update (macOS):");
    const enrolledLabel = enrolled === true ? "yes" : enrolled === false ? "no" : "not yet decided";
    console.log(`  enrolled: ${enrolledLabel}`);
    console.log(`  plist present: ${plistPresent ? "yes" : "no"}`);
    console.log(`  last run: ${lastRun ? `${lastRun.at} (${lastRun.status})` : "never run"}`);
  }

  console.log("");

  if (data.warnings.length === 0) {
    success("all checks passed");
  } else {
    for (const { message } of data.warnings) warn(message);
  }
}
