import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  DEFAULT_CODEX_SKILL_BUDGET_TOKENS,
  findSkillFiles,
  formatCodexSkillBudget,
  measureCodexSkillBudget,
  readSkillDescription,
} from "../src/lib/codex-skill-budget.ts";

const REPO = resolve(import.meta.dir, "..");
const CLI = join(REPO, "src", "scripts", "codex-skill-budget.ts");

const homes: string[] = [];

async function makeHome(prefix: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function writeSkill(dir: string, description: string, name?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const lines = ["---"];
  if (name) lines.push(`name: ${name}`);
  lines.push(`description: ${description}`, "---", "", "body");
  await writeFile(join(dir, "SKILL.md"), lines.join("\n"));
}

async function writeConfig(home: string, content: string): Promise<void> {
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex", "config.toml"), content);
}

function pluginCacheDir(home: string, marketplace: string, name: string, version: string): string {
  return join(home, ".codex", "plugins", "cache", marketplace, name, version);
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(home: string, args: string[]): Promise<CommandResult> {
  const child = Bun.spawn(["bun", CLI, ...args], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, ".codex"),
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("measureCodexSkillBudget: totals per source", () => {
  test("sums descriptions per source, excludes disabled plugins, sorts by chars", async () => {
    const home = await makeHome("cc-skill-budget-totals-");

    // Enabled plugin alpha@mp1: two skills, 100 + 50 = 150 chars.
    const alphaDir = pluginCacheDir(home, "mp1", "alpha", "1.0.0");
    await writeSkill(join(alphaDir, "skills", "skill-a"), "a".repeat(100));
    await writeSkill(join(alphaDir, "skills", "skill-b"), "b".repeat(50));

    // Disabled plugin beta@mp1: never read, so no files needed on disk.
    // User skill directly under .codex/skills/<skill>, the layout Codex documents.
    await writeSkill(join(home, ".codex", "skills", "user-skill"), "u".repeat(80));
    // Codex built-in.
    await writeSkill(join(home, ".codex", "skills", ".system", "sys-skill"), "s".repeat(60));
    // ~/.agents/skills.
    await writeSkill(join(home, ".agents", "skills", "agent-skill"), "g".repeat(40));

    await writeConfig(
      home,
      [
        '[plugins."alpha@mp1"]',
        "enabled = true",
        "",
        '[plugins."beta@mp1"]',
        "enabled = false",
        "",
      ].join("\n"),
    );

    const report = await measureCodexSkillBudget({ home });

    expect(report.disabledPlugins).toEqual(["beta@mp1"]);
    expect(report.sources.some((source) => source.pluginId === "beta@mp1")).toBe(false);

    const bySource = new Map(report.sources.map((source) => [source.label, source]));
    expect(bySource.get("plugin alpha@mp1")).toMatchObject({ skills: 2, descriptionChars: 150 });
    expect(bySource.get("user $CODEX_HOME/skills")).toMatchObject({
      skills: 1,
      descriptionChars: 80,
    });
    expect(bySource.get("codex built-in (.system)")).toMatchObject({
      skills: 1,
      descriptionChars: 60,
    });
    expect(bySource.get("user ~/.agents/skills")).toMatchObject({
      skills: 1,
      descriptionChars: 40,
    });

    // totalSkills counts only enabled sources: 2 (alpha) + 1 + 1 + 1 = 5.
    expect(report.totalSkills).toBe(5);
    expect(report.descriptionChars).toBe(150 + 80 + 60 + 40);

    // Sorted descending by descriptionChars.
    expect(report.sources.map((source) => source.descriptionChars)).toEqual([150, 80, 60, 40]);
  });
});

describe("measureCodexSkillBudget: plugin resolution", () => {
  test("newest cached plugin version wins", async () => {
    const home = await makeHome("cc-skill-budget-version-");
    const oldDir = pluginCacheDir(home, "mp2", "ver", "1.0.0");
    const newDir = pluginCacheDir(home, "mp2", "ver", "1.2.0");
    await writeSkill(join(oldDir, "skills", "skill-old"), "o".repeat(10));
    await writeSkill(join(newDir, "skills", "skill-new"), "n".repeat(25));
    await writeConfig(home, ['[plugins."ver@mp2"]', "enabled = true", ""].join("\n"));

    const report = await measureCodexSkillBudget({ home });

    const source = report.sources.find((entry) => entry.pluginId === "ver@mp2");
    expect(source).toMatchObject({ skills: 1, descriptionChars: 25 });
    expect(report.entries.filter((entry) => entry.source === "plugin ver@mp2")).toHaveLength(1);
    expect(report.entries.find((entry) => entry.source === "plugin ver@mp2")?.name).toBe(
      "skill-new",
    );
  });

  test("orders version directories numerically so 1.10.0 beats 1.9.0", async () => {
    const home = await makeHome("cc-skill-budget-semver-");
    await writeSkill(join(pluginCacheDir(home, "mp1", "alpha", "1.9.0"), "skills", "s"), "old!");
    await writeSkill(
      join(pluginCacheDir(home, "mp1", "alpha", "1.10.0"), "skills", "s"),
      "n".repeat(70),
    );
    await writeConfig(home, ['[plugins."alpha@mp1"]', "enabled = true", ""].join("\n"));

    const report = await measureCodexSkillBudget({ home });

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]?.descriptionChars).toBe(70);
    expect(report.entries[0]?.path).toContain("1.10.0");
  });

  test("excludes skills hidden through [[skills.config]] enabled = false", async () => {
    const home = await makeHome("cc-skill-budget-disabled-skill-");
    const alphaDir = pluginCacheDir(home, "mp1", "alpha", "1.0.0");
    await writeSkill(join(alphaDir, "skills", "kept"), "k".repeat(30));
    await writeSkill(join(alphaDir, "skills", "hidden"), "h".repeat(90));
    const hiddenPath = join(alphaDir, "skills", "hidden", "SKILL.md");
    await writeConfig(
      home,
      [
        '[plugins."alpha@mp1"]',
        "enabled = true",
        "",
        "[[skills.config]]",
        `path = ${JSON.stringify(hiddenPath)}`,
        "enabled = false",
        "",
      ].join("\n"),
    );

    const report = await measureCodexSkillBudget({ home });

    expect(report.totalSkills).toBe(1);
    expect(report.descriptionChars).toBe(30);
    expect(report.disabledSkills).toEqual([hiddenPath]);
    expect(report.entries.map((entry) => entry.name)).toEqual(["kept"]);
  });

  test("falls back to the marketplace source when the plugin is not cached", async () => {
    const home = await makeHome("cc-skill-budget-marketplace-");
    const marketplaceDir = join(home, "mp3-source");
    await writeSkill(join(marketplaceDir, "plugins", "gamma", "skills", "skill-g"), "m".repeat(35));
    await writeConfig(
      home,
      [
        '[plugins."gamma@mp3"]',
        "enabled = true",
        "",
        "[marketplaces.mp3]",
        'source_type = "local"',
        `source = "${marketplaceDir.split(sep).join("/")}"`,
        "",
      ].join("\n"),
    );

    const report = await measureCodexSkillBudget({ home });

    const source = report.sources.find((entry) => entry.pluginId === "gamma@mp3");
    expect(source).toMatchObject({ skills: 1, descriptionChars: 35 });
  });
});

describe("measureCodexSkillBudget: budget verdict", () => {
  async function seedSingleSkill(home: string): Promise<void> {
    // ~/.agents/skills/<skill>/SKILL.md is discovered directly (one level
    // below the source root), unlike a flat .codex/skills/<skill>/SKILL.md.
    await writeSkill(join(home, ".agents", "skills", "solo-skill"), "x".repeat(50));
  }

  test("under the default budget with plenty of headroom", async () => {
    const home = await makeHome("cc-skill-budget-under-");
    await seedSingleSkill(home);

    const report = await measureCodexSkillBudget({ home });

    expect(report.budgetTokens).toBe(DEFAULT_CODEX_SKILL_BUDGET_TOKENS);
    expect(report.listingChars).toBeLessThan(40_000);
    expect(report.overBudget).toBe(false);
    expect(report.overshootChars).toBe(0);
  });

  test("over a tight explicit budget by exactly listingChars minus cap", async () => {
    const home = await makeHome("cc-skill-budget-over-");
    await seedSingleSkill(home);

    const report = await measureCodexSkillBudget({ home, budgetTokens: 10 });

    expect(report.overBudget).toBe(true);
    expect(report.overshootChars).toBe(report.listingChars - 40);
  });

  test("[skills] max_context_tokens lowers the budget when the requested budget is larger", async () => {
    const home = await makeHome("cc-skill-budget-cap-lower-");
    await seedSingleSkill(home);
    await writeConfig(home, ["[skills]", "max_context_tokens = 5", ""].join("\n"));

    const report = await measureCodexSkillBudget({ home });

    expect(report.configuredMaxContextTokens).toBe(5);
    expect(report.budgetTokens).toBe(5);
  });

  test("[skills] max_context_tokens never raises the budget above the requested value", async () => {
    const home = await makeHome("cc-skill-budget-cap-noraise-");
    await seedSingleSkill(home);
    await writeConfig(home, ["[skills]", "max_context_tokens = 16000", ""].join("\n"));

    const report = await measureCodexSkillBudget({ home });

    expect(report.configuredMaxContextTokens).toBe(16000);
    expect(report.budgetTokens).toBe(DEFAULT_CODEX_SKILL_BUDGET_TOKENS);
  });
});

describe("measureCodexSkillBudget: config.toml edge cases", () => {
  test("resolves with zero plugin sources when config.toml is missing entirely", async () => {
    const home = await makeHome("cc-skill-budget-noconfig-");

    const report = await measureCodexSkillBudget({ home });

    expect(report.sources.filter((source) => source.pluginId)).toEqual([]);
    expect(report.totalSkills).toBe(0);
    expect(report.disabledPlugins).toEqual([]);
  });

  test("rejects with a message naming the config path on malformed TOML", async () => {
    const home = await makeHome("cc-skill-budget-malformed-");
    const configPath = join(home, ".codex", "config.toml");
    await writeConfig(home, "[plugins\nbroken");

    await expect(measureCodexSkillBudget({ home })).rejects.toThrow(configPath);
  });
});

describe("findSkillFiles", () => {
  test("skips .tmp and node_modules, and stops descending once SKILL.md is found", async () => {
    const home = await makeHome("cc-skill-budget-walk-");
    const root = join(home, "root");

    await writeSkill(join(root, ".tmp", "skill-x"), "t".repeat(10));
    await writeSkill(join(root, "node_modules", "skill-y"), "n".repeat(10));
    await writeSkill(join(root, "skill-a"), "a".repeat(10));
    // A nested SKILL.md below a directory that itself already has one: must
    // not be found, since the walker stops descending at skill-a.
    await writeSkill(join(root, "skill-a", "nested"), "z".repeat(10));
    await writeSkill(join(root, "group", "skill-b"), "b".repeat(10));

    const found = await findSkillFiles(root);

    expect(found.sort()).toEqual(
      [join(root, "group", "skill-b", "SKILL.md"), join(root, "skill-a", "SKILL.md")].sort(),
    );
    expect(found).not.toContain(join(root, "skill-a", "nested", "SKILL.md"));
  });
});

describe("readSkillDescription", () => {
  test("folds a block-scalar description across lines", async () => {
    const home = await makeHome("cc-skill-budget-blockscalar-");
    const dir = join(home, "block-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      [
        "---",
        "name: block-skill",
        "description: >",
        "  first line",
        "  second line",
        "---",
        "",
        "body",
      ].join("\n"),
    );

    const result = await readSkillDescription(join(dir, "SKILL.md"));

    expect(result).toEqual({ name: "block-skill", description: "first line second line" });
  });

  test("returns an empty description and the directory name when frontmatter is absent", async () => {
    const home = await makeHome("cc-skill-budget-nofrontmatter-");
    const dir = join(home, "no-fm-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "no frontmatter here\n");

    const result = await readSkillDescription(join(dir, "SKILL.md"));

    expect(result).toEqual({ name: "no-fm-skill", description: "" });
  });
});

describe("formatCodexSkillBudget", () => {
  test("prints an OVER verdict with a disable snippet, never suggesting darkroom@cc-settings", async () => {
    const home = await makeHome("cc-skill-budget-format-over-");
    const darkroomDir = pluginCacheDir(home, "cc-settings", "darkroom", "1.0.0");
    const otherDir = pluginCacheDir(home, "mp", "other", "1.0.0");
    // darkroom is the largest source, but must never be suggested for disabling.
    await writeSkill(join(darkroomDir, "skills", "big-skill"), "d".repeat(1000));
    await writeSkill(join(otherDir, "skills", "other-skill"), "o".repeat(700));
    await writeConfig(
      home,
      [
        '[plugins."darkroom@cc-settings"]',
        "enabled = true",
        "",
        '[plugins."other@mp"]',
        "enabled = true",
        "",
      ].join("\n"),
    );

    // 1700 description chars + 2 entries * 64 overhead = 1828 listing chars;
    // 324 tokens * 4 = 1296 chars of budget; overshoot 532.
    const report = await measureCodexSkillBudget({ home, budgetTokens: 324 });
    expect(report.overBudget).toBe(true);
    expect(report.overshootChars).toBe(532);

    const output = formatCodexSkillBudget(report, home);

    expect(output).toContain("Codex skills context budget");
    expect(output).toContain("TOTAL descriptions");
    expect(output).toContain("verdict: OVER");
    expect(output).toContain('[plugins."other@mp"]');
    expect(output).not.toContain('[plugins."darkroom@cc-settings"]');
  });

  test("prints an under-budget verdict when there is headroom", async () => {
    const home = await makeHome("cc-skill-budget-format-under-");
    await writeSkill(join(home, ".agents", "skills", "solo-skill"), "x".repeat(50));

    const report = await measureCodexSkillBudget({ home });
    expect(report.overBudget).toBe(false);

    const output = formatCodexSkillBudget(report, home);

    expect(output).toContain("verdict: under budget");
  });
});

describe("codex:skill-budget CLI", () => {
  test("exits 0 and prints a TOTAL row when under budget", async () => {
    const home = await makeHome("cc-skill-budget-cli-under-");
    await writeSkill(join(home, ".agents", "skills", "solo-skill"), "x".repeat(50));

    const result = await runCli(home, []);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("TOTAL");
  });

  test("exits 1 with a tight --budget", async () => {
    const home = await makeHome("cc-skill-budget-cli-over-");
    await writeSkill(join(home, ".agents", "skills", "solo-skill"), "x".repeat(50));

    const result = await runCli(home, ["--budget", "10"]);

    expect(result.exitCode).toBe(1);
  });

  test("--json prints a parseable report containing overBudget", async () => {
    const home = await makeHome("cc-skill-budget-cli-json-");
    await writeSkill(join(home, ".agents", "skills", "solo-skill"), "x".repeat(50));

    const result = await runCli(home, ["--json", "--budget", "10"]);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("overBudget", true);
  });

  test("exits 2 with a usage error for a non-numeric --budget", async () => {
    const home = await makeHome("cc-skill-budget-cli-badflag-");

    const result = await runCli(home, ["--budget", "nope"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--budget");
  });

  test("--help exits 0 and prints usage", async () => {
    const home = await makeHome("cc-skill-budget-cli-help-");

    const result = await runCli(home, ["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
  });
});
