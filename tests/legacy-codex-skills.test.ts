import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrateLegacyCodexSkills, scanLegacyCodexSkills } from "../src/lib/managed-skills.ts";

const REPO = resolve(import.meta.dir, "..");
const SETUP = join(REPO, "src", "setup.ts");
const MIGRATE = join(REPO, "src", "scripts", "migrate-legacy-codex-skills.ts");

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function seedSkill(home: string, name: string, content = name): Promise<string> {
  const dir = join(home, ".agents", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
  return dir;
}

async function runSetup(home: string, args: string[]): Promise<CommandResult> {
  const child = Bun.spawn(["bun", SETUP, `--source=${REPO}`, "--target=codex", ...args], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, ".codex"),
      NODE_ENV: "test",
      CC_SKIP_DEPS: "1",
      CC_SKIP_SCHEDULE: "1",
      CC_SKIP_CODEX_CLI: "1",
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

async function runMigration(
  home: string,
  codexHome: string,
  args: string[] = [],
): Promise<CommandResult> {
  const child = Bun.spawn(["bun", MIGRATE, ...args], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: codexHome,
      NODE_ENV: "test",
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

async function legacySkillBackups(home: string): Promise<string[]> {
  return (await readdir(join(home, ".agents")).catch(() => []))
    .filter((name) => name.startsWith("skills-backup-cc-settings-"))
    .sort();
}

describe("legacy Codex skill migration", () => {
  test("dry-run finds only active overlaps and changes nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-dry-"));
    try {
      await seedSkill(home, "audit");
      await seedSkill(home, "build");
      await seedSkill(home, "context7-mcp");
      await seedSkill(home, "programa");

      const result = await migrateLegacyCodexSkills({
        home,
        now: new Date("2026-08-21T12:34:56.789Z"),
      });

      expect(result.scan.overlapNames).toEqual(["audit", "build"]);
      expect(result.scan.movableNames).toEqual(["audit", "build"]);
      expect(result.scan.blockedNames).toEqual([]);
      expect(result.applied).toBe(false);
      expect(result.movedNames).toEqual([]);
      expect(result.backupDir).toBe(
        join(home, ".agents", "skills-backup-cc-settings-20260821T123456-789Z"),
      );
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(true);
      expect(existsSync(join(home, ".agents", "skills", "context7-mcp"))).toBe(true);
      expect(existsSync(result.backupDir as string)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("--apply moves overlaps into one timestamped backup and preserves non-overlaps", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-apply-"));
    try {
      await seedSkill(home, "audit", "legacy audit");
      await seedSkill(home, "build", "legacy build");
      await seedSkill(home, "context7-mcp", "keep context7");
      await seedSkill(home, "programa", "keep programa");

      const result = await migrateLegacyCodexSkills({
        home,
        apply: true,
        now: new Date("2026-08-21T12:34:56.789Z"),
      });

      expect(result.applied).toBe(true);
      expect(result.movedNames).toEqual(["audit", "build"]);
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(false);
      expect(await readFile(join(result.backupDir as string, "audit", "SKILL.md"), "utf8")).toBe(
        "legacy audit",
      );
      expect(
        await readFile(join(home, ".agents", "skills", "context7-mcp", "SKILL.md"), "utf8"),
      ).toBe("keep context7");
      expect(await readFile(join(home, ".agents", "skills", "programa", "SKILL.md"), "utf8")).toBe(
        "keep programa",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("apply refuses a same-name symlink and leaves its target untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-link-"));
    const outside = await mkdtemp(join(tmpdir(), "cc-legacy-skills-target-"));
    try {
      await writeFile(join(outside, "SKILL.md"), "outside");
      await mkdir(join(home, ".agents", "skills"), { recursive: true });
      await symlink(outside, join(home, ".agents", "skills", "audit"));

      const scan = await scanLegacyCodexSkills(home);
      expect(scan.overlapNames).toEqual(["audit"]);
      expect(scan.blockedNames).toEqual(["audit"]);
      await expect(migrateLegacyCodexSkills({ home, apply: true })).rejects.toThrow(
        "Refusing to move non-directory or symlinked legacy skill entries: audit",
      );
      expect(await readFile(join(outside, "SKILL.md"), "utf8")).toBe("outside");
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("scan refuses a symlinked .agents parent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-parent-link-"));
    const outside = await mkdtemp(join(tmpdir(), "cc-legacy-skills-parent-target-"));
    try {
      await seedSkill(outside, "audit");
      await symlink(join(outside, ".agents"), join(home, ".agents"));

      await expect(scanLegacyCodexSkills(home)).rejects.toThrow(
        "Refusing unsafe legacy skills parent",
      );
      expect(existsSync(join(outside, ".agents", "skills", "audit"))).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("Codex full install and dry-run warn without moving overlaps", async () => {
    const dryHome = await mkdtemp(join(tmpdir(), "cc-legacy-skills-install-dry-"));
    const installHome = await mkdtemp(join(tmpdir(), "cc-legacy-skills-install-live-"));
    try {
      await seedSkill(dryHome, "audit");
      await seedSkill(installHome, "audit");

      const dryRun = await runSetup(dryHome, ["--dry-run"]);
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stdout).toContain("legacy");
      expect(dryRun.stdout).toContain("Codex may shorten skill descriptions");
      expect(dryRun.stdout).toContain("bun run migrate:codex-skills --apply");
      expect(existsSync(join(dryHome, ".agents", "skills", "audit"))).toBe(true);

      const install = await runSetup(installHome, []);
      expect(install.exitCode).toBe(0);
      expect(install.stderr).toContain("Codex may shorten skill descriptions");
      expect(existsSync(join(installHome, ".agents", "skills", "audit"))).toBe(true);
    } finally {
      await rm(dryHome, { recursive: true, force: true });
      await rm(installHome, { recursive: true, force: true });
    }
  });

  test("CLI preview warns when desktop import sync is enabled and leaves overlaps untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-sync-preview-"));
    const codexHome = join(home, "custom-codex-home");
    try {
      await seedSkill(home, "audit", "legacy audit");
      await mkdir(codexHome, { recursive: true });
      await writeFile(
        join(codexHome, "config.toml"),
        "[desktop]\nexternal-agent-import-sync-enabled = true\n",
      );

      const preview = await runMigration(home, codexHome);
      const output = `${preview.stdout}\n${preview.stderr}`;

      expect(preview.exitCode).toBe(0);
      expect(output).toContain("audit");
      expect(output).toMatch(/external-agent-import-sync-enabled|desktop.*import.*sync/i);
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(true);
      expect(await legacySkillBackups(home)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("CLI apply refuses a quoted enabled desktop import-sync key without creating a backup", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-sync-apply-"));
    const codexHome = join(home, "custom-codex-home");
    try {
      await seedSkill(home, "audit", "legacy audit");
      await mkdir(codexHome, { recursive: true });
      await writeFile(
        join(codexHome, "config.toml"),
        '[desktop]\n"external-agent-import-sync-enabled" = true\n',
      );

      const apply = await runMigration(home, codexHome, ["--apply"]);

      expect(apply.exitCode).not.toBe(0);
      expect(`${apply.stdout}\n${apply.stderr}`).toMatch(
        /external-agent-import-sync-enabled|desktop.*import.*sync/i,
      );
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(true);
      expect(await legacySkillBackups(home)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each([
    {
      label: "disabled desktop import sync",
      config: "[desktop]\nexternal-agent-import-sync-enabled = false\n",
    },
    { label: "no Codex config", config: null },
  ])("CLI apply remains available with $label", async ({ config }) => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-sync-permitted-"));
    const codexHome = join(home, "custom-codex-home");
    try {
      await seedSkill(home, "audit", "legacy audit");
      if (config !== null) {
        await mkdir(codexHome, { recursive: true });
        await writeFile(join(codexHome, "config.toml"), config);
      }

      const apply = await runMigration(home, codexHome, ["--apply"]);
      const backups = await legacySkillBackups(home);

      expect(apply.exitCode, `${apply.stdout}\n${apply.stderr}`).toBe(0);
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(false);
      expect(backups).toHaveLength(1);
      expect(
        await readFile(join(home, ".agents", backups[0] as string, "audit", "SKILL.md"), "utf8"),
      ).toBe("legacy audit");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each([
    { label: "malformed TOML", config: "[desktop\nexternal-agent-import-sync-enabled = false\n" },
    {
      label: "a non-boolean import-sync value",
      config: '[desktop]\nexternal-agent-import-sync-enabled = "false"\n',
    },
  ])("CLI apply fails closed for $label", async ({ config }) => {
    const home = await mkdtemp(join(tmpdir(), "cc-legacy-skills-sync-invalid-"));
    const codexHome = join(home, "custom-codex-home");
    try {
      await seedSkill(home, "audit", "legacy audit");
      await mkdir(codexHome, { recursive: true });
      await writeFile(join(codexHome, "config.toml"), config);

      const apply = await runMigration(home, codexHome, ["--apply"]);

      expect(apply.exitCode).not.toBe(0);
      expect(`${apply.stdout}\n${apply.stderr}`).toMatch(/config|toml|boolean|invalid|parse/i);
      expect(existsSync(join(home, ".agents", "skills", "audit"))).toBe(true);
      expect(await legacySkillBackups(home)).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
