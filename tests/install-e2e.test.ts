// End-to-end install test. Spawns `bun src/setup.ts --source=<repo>` with
// HOME pointed at a tmpdir and asserts the resulting tree shape.
//
// Why this matters: unit tests cover the merger, the compose, and individual
// scripts. They don't cover the install ORCHESTRATION — the order things run,
// the actual file copies, the version sentinel write, the link-vs-copy logic
// for node_modules. This test fires the whole flow and verifies the end state.
//
// Sets CC_SKIP_DEPS=1 to bypass `pipx install llm-tldr` and similar global
// installs — those write outside HOME and would pollute the dev/CI environment.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { currentClaudeManagedSourceFiles } from "../src/lib/claude-managed-file-manifests.ts";
import {
  CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  claudeManagedAllowedPaths,
} from "../src/lib/claude-managed-files.ts";
import { verifySrcManifest } from "../src/lib/hooks-fingerprint.ts";
import { LIGHT_SKILLS } from "../src/lib/light-profile.ts";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");

// Whole installer runs copy and hash the managed tree several times. Windows
// hosted runners regularly exceed Bun's 5-second unit-test default even when
// the installer succeeds, so this E2E file uses a suite-appropriate ceiling.
setDefaultTimeout(120_000);

interface InstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runInstall(
  home: string,
  extraArgs: string[] = [],
  target: "claude" | "codex" | "both" = "claude",
  extraEnv: Record<string, string> = {},
  source: string = REPO,
): Promise<InstallResult> {
  const proc = Bun.spawn(
    [process.execPath, SETUP_TS, `--source=${source}`, `--target=${target}`, ...extraArgs],
    {
      env: {
        ...process.env,
        HOME: home,
        // os.homedir() reads USERPROFILE on Windows, not HOME — set both so the
        // installer targets the tmpdir on every platform.
        USERPROFILE: home,
        CODEX_HOME: join(home, ".codex"),
        NODE_ENV: "test",
        CC_SKIP_DEPS: "1",
        // launchctl ignores a faked $HOME and would register/bootout a REAL
        // launchd job on the machine running the test suite — unconditional,
        // regardless of whether a given test even touches auto-update.
        CC_SKIP_SCHEDULE: "1",
        CC_SKIP_CODEX_CLI: "1",
        // Avoid color codes / banner art bleeding into assertion strings.
        NO_COLOR: "1",
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function packagedVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(REPO, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

function neighboringMajor(version: string, direction: "older" | "newer"): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a semantic release version, received ${version}`);
  const major = Number.parseInt(match[1] as string, 10);
  if (direction === "newer") return `${major + 1}.0.0`;
  if (major === 0) throw new Error(`Cannot construct an older major release from ${version}`);
  return `${major - 1}.0.0`;
}

async function rewriteSentinelVersion(path: string, version: string): Promise<void> {
  const sentinel = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  sentinel.version = version;
  await writeFile(path, `${JSON.stringify(sentinel, null, 2)}\n`);
}

async function directoryEntries(path: string): Promise<string[]> {
  return (await readdir(path, { recursive: true }).catch(() => [])).sort();
}

async function copySourceFixture(parent: string): Promise<string> {
  const source = join(parent, "source");
  await cp(REPO, source, {
    recursive: true,
    filter: (path) => {
      const relativePath = path.slice(REPO.length).replace(/^[/\\]/, "");
      return !relativePath
        .split(/[/\\]+/)
        .some((part) => [".git", "node_modules", ".venv", ".tldr", "backups"].includes(part));
    },
  });
  return source;
}

async function gitBytes(sourceDir: string, args: string[]): Promise<Buffer> {
  const child = Bun.spawn(["git", "-C", sourceDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return Buffer.from(stdout);
}

async function historicalCommit(sourceDir: string, version: string): Promise<string[]> {
  return (
    await gitBytes(sourceDir, [
      "log",
      "--format=%H",
      `-G"version"[[:space:]]*:[[:space:]]*"${version}"`,
      "--",
      "package.json",
    ])
  )
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function installHistoricalClaudeFiles(
  home: string,
  sourceDir: string,
  version: string,
): Promise<{ commit: string; destinations: string[] }> {
  const commits = await historicalCommit(sourceDir, version);
  expect(commits).toHaveLength(1);
  const commit = commits[0] as string;
  const staging = join(home, "historical-source");
  const archive = join(home, "historical-source.tar");
  const selected = [
    "CLAUDE-FULL.md",
    "AGENTS.md",
    "agents",
    "skills",
    "profiles",
    "rules",
    "hooks",
    "docs",
    "output-styles",
    "src",
    "package.json",
    "tsconfig.json",
    "bun.lock",
  ];
  await mkdir(staging);
  await writeFile(
    archive,
    await gitBytes(sourceDir, ["archive", "--format=tar", commit, ...selected]),
  );
  const extract = Bun.spawn(["tar", "-xf", archive, "-C", staging], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [extractError, extractCode] = await Promise.all([
    new Response(extract.stderr).text(),
    extract.exited,
  ]);
  if (extractCode !== 0) throw new Error(`historical archive extraction failed: ${extractError}`);
  const listing = (await gitBytes(sourceDir, ["ls-tree", "-r", commit, "--", ...selected]))
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const destinations: string[] = [];
  for (const line of listing) {
    const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(line);
    if (!match) continue;
    const sourcePath = match[2] as string;
    if (sourcePath.includes("/.tldr/") || sourcePath.endsWith("/.tldrignore")) continue;
    if (["src/package.json", "src/tsconfig.json", "src/bun.lock"].includes(sourcePath)) continue;
    const destination =
      sourcePath === "CLAUDE-FULL.md"
        ? "CLAUDE.md"
        : ["package.json", "tsconfig.json", "bun.lock"].includes(sourcePath)
          ? `src/${sourcePath}`
          : sourcePath;
    const destinationPath = join(home, ".claude", destination);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(join(staging, sourcePath), destinationPath);
    destinations.push(destination);
  }
  if (existsSync(join(sourceDir, "node_modules"))) {
    await symlink(join(sourceDir, "node_modules"), join(home, ".claude", "src", "node_modules"));
  }
  await rm(staging, { recursive: true, force: true });
  await rm(archive);
  return { commit, destinations };
}

async function createHistoricalSourceFixture(home: string): Promise<{
  source: string;
  version: string;
}> {
  const source = await realpath(await copySourceFixture(home));
  const packagePath = join(source, "package.json");
  const skillPath = join(source, "skills", "cc", "SKILL.md");
  const retiredPath = join(source, "rules", "retired-legacy.md");
  const [currentPackage, currentSkill] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(skillPath, "utf8"),
  ]);
  const legacyVersion = "0.0.0-legacy-fixture";
  const legacyPackage = JSON.parse(currentPackage) as Record<string, unknown>;
  legacyPackage.version = legacyVersion;
  await Promise.all([
    writeFile(packagePath, `${JSON.stringify(legacyPackage, null, 2)}\n`),
    writeFile(skillPath, "legacy cc skill bytes\n"),
    writeFile(retiredPath, "historical retired rule bytes\n"),
  ]);
  await gitBytes(source, ["init"]);
  await gitBytes(source, ["add", "."]);
  await gitBytes(source, [
    "-c",
    "user.name=cc-settings tests",
    "-c",
    "user.email=tests@invalid.example",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "legacy fixture",
  ]);
  await Promise.all([
    writeFile(packagePath, currentPackage),
    writeFile(skillPath, currentSkill),
    rm(retiredPath),
  ]);
  await mkdir(join(source, "node_modules"));
  return { source, version: legacyVersion };
}

async function runRemoteBootstrap(
  home: string,
  origin = "https://github.com/darkroomengineering/cc-settings.git",
  history: "official" | "ahead" | "diverged" = "official",
): Promise<InstallResult> {
  const bin = join(home, "bootstrap-bin");
  const log = join(home, "bootstrap-bun.log");
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, "git"),
    `#!/usr/bin/env bash
case " $* " in
  *" clone "*)
    destination="\${!#}"
    cp "$BOOTSTRAP_SOURCE" "$destination/setup.sh"
    mkdir -p "$destination/.git/refs/heads"
    printf '[remote "origin"]\\n  url = %s\\n' "$FAKE_ORIGIN" > "$destination/.git/config"
    printf 'ref: refs/heads/main\\n' > "$destination/.git/HEAD"
    printf '${"1".repeat(40)}\\n' > "$destination/.git/refs/heads/main"
    printf fixture > "$destination/.git/index"
    ;;
  *" config --file "*" remote.origin.url "*) printf '%s\\n' "$FAKE_ORIGIN" ;;
  *" merge-base --is-ancestor "*)
    [ "$FAKE_HISTORY" = "official" ]
    ;;
  *" rev-parse HEAD "*) printf '${"1".repeat(40)}\\n' ;;
  *" read-tree "*|*" diff-files --quiet "*|*" ls-files --others "*|*" diff-index --cached "*|*" checkout -B main "*|*" merge --ff-only "*) ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 2 ;;
esac
`,
  );
  await writeFile(
    join(bin, "bun"),
    '#!/bin/sh\nif [ "$1" = "install" ]; then exit 0; fi\nprintf \'%s\\n\' "$*" > "$BOOTSTRAP_LOG"\n',
  );
  await Promise.all([chmod(join(bin, "git"), 0o755), chmod(join(bin, "bun"), 0o755)]);
  const proc = Bun.spawn(["bash", "-c", 'bash <(cat "$BOOTSTRAP_SOURCE") --light'], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: prependTestPath(bin),
      BOOTSTRAP_SOURCE: gitBashPath(join(REPO, "setup.sh")),
      BOOTSTRAP_LOG: gitBashPath(log),
      FAKE_ORIGIN: origin,
      FAKE_HISTORY: history,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("setup.sh remote bootstrap", () => {
  test("keeps the rules README source-only", () => {
    const managed = currentClaudeManagedSourceFiles("full").map(({ source }) => source);
    expect(managed).not.toContain("rules/README.md");
  });

  test("upgrades a version-3 install and removes its managed rules README", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-v3-rules-readme-"));
    const claudeDir = join(home, ".claude");
    try {
      expect((await runInstall(home)).exitCode).toBe(0);
      const readmePath = join(claudeDir, "rules", "README.md");
      const readmeBytes = await readFile(join(REPO, "rules", "README.md"), "utf8");
      await writeFile(readmePath, readmeBytes);
      const sentinelPath = join(claudeDir, ".cc-settings-version");
      const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
        managed_files_manifest_version: number;
      };
      sentinel.managed_files["rules/README.md"] = new Bun.CryptoHasher("sha256")
        .update(readmeBytes)
        .digest("hex");
      sentinel.managed_files_manifest_version = 3;
      await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);

      const upgrade = await runInstall(home);

      expect(upgrade.exitCode, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);
      expect(existsSync(readmePath)).toBe(false);
      const upgraded = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
        managed_files_manifest_version: number;
      };
      expect(upgraded.managed_files_manifest_version).toBe(
        CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
      );
      expect(upgraded.managed_files["rules/README.md"]).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("upgrades an exact version-2 install and removes its retired knowledge migration plan", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-v2-knowledge-plan-"));
    const claudeDir = join(home, ".claude");
    try {
      expect((await runInstall(home)).exitCode).toBe(0);
      const retired = "docs/plans/knowledge-repo-migration.md";
      const retiredPath = join(claudeDir, retired);
      const retiredBytes = "historical knowledge-repo migration plan bytes\n";
      const readme = "rules/README.md";
      await Promise.all([
        mkdir(dirname(retiredPath), { recursive: true }),
        writeFile(join(claudeDir, readme), await readFile(join(REPO, readme))),
      ]);
      await writeFile(retiredPath, retiredBytes);

      const sentinelPath = join(claudeDir, ".cc-settings-version");
      const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
        managed_files_manifest_version: number;
      };
      const version2Paths = await claudeManagedAllowedPaths(REPO, "full", 2);
      version2Paths.add(retired);
      await Promise.all(
        Object.keys(sentinel.managed_files)
          .filter((path) => !version2Paths.has(path))
          .map((path) => rm(join(claudeDir, path))),
      );
      sentinel.managed_files = Object.fromEntries(
        await Promise.all(
          [...version2Paths].map(async (path) => [
            path,
            new Bun.CryptoHasher("sha256")
              .update(await readFile(join(claudeDir, path)))
              .digest("hex"),
          ]),
        ),
      );
      sentinel.managed_files_manifest_version = 2;
      await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);

      const upgrade = await runInstall(home);

      expect(upgrade.exitCode, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);
      expect(existsSync(retiredPath)).toBe(false);
      const upgraded = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
        managed_files_manifest_version: number;
      };
      expect(upgraded.managed_files_manifest_version).toBe(
        CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
      );
      expect(upgraded.managed_files[retired]).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("every full-install source file is tracked by Git", () => {
    const expected = [
      ...new Set(
        currentClaudeManagedSourceFiles("full").map(({ source }) => source.replaceAll("\\", "/")),
      ),
    ].sort();
    const tracked = Bun.spawnSync(["git", "ls-files", "--", ...expected], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(tracked.exitCode, tracked.stderr.toString()).toBe(0);
    const actual = [
      ...new Set(
        tracked.stdout
          .toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((path) => path.replaceAll("\\", "/")),
      ),
    ].sort();
    const missing = expected.filter((path) => !actual.includes(path));
    const unexpected = actual.filter((path) => !expected.includes(path));
    expect(actual, JSON.stringify({ missing, unexpected }, null, 2)).toEqual(expected);
  });

  test("installs bootstrap dependencies from the frozen lockfile without lifecycle scripts", async () => {
    const bootstrap = await readFile(join(REPO, "setup.sh"), "utf8");
    expect(bootstrap).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(bootstrap).not.toMatch(/\|\|\s*\(cd .*bun install(?!.*--frozen-lockfile)/);
  });

  test.skipIf(process.platform === "win32")(
    "installs from a durable managed checkout",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-bootstrap-durable-"));
      try {
        const result = await runRemoteBootstrap(home);
        const source = join(home, ".local", "share", "cc-settings", "source");

        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(existsSync(join(source, ".git", "config"))).toBe(true);
        expect(await readFile(join(home, "bootstrap-bun.log"), "utf8")).toContain(
          `--source=${source}`,
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32").each(["ahead", "diverged"] as const)(
    "rejects a clean managed checkout whose history is %s of official main",
    async (history) => {
      const home = await mkdtemp(join(tmpdir(), "cc-bootstrap-history-"));
      const source = join(home, ".local", "share", "cc-settings", "source");
      try {
        await mkdir(join(source, ".git", "refs", "heads"), { recursive: true });
        await cp(join(REPO, "setup.sh"), join(source, "setup.sh"));
        await writeFile(
          join(source, ".git", "config"),
          '[remote "origin"]\n  url = https://github.com/darkroomengineering/cc-settings.git\n',
        );
        await writeFile(join(source, ".git", "HEAD"), "ref: refs/heads/main\n");
        await writeFile(join(source, ".git", "refs", "heads", "main"), `${"2".repeat(40)}\n`);
        await writeFile(join(source, ".git", "index"), "fixture\n");
        const result = await runRemoteBootstrap(home, undefined, history);

        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/local commits|diverges/i);
        expect(existsSync(join(home, "bootstrap-bun.log"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32").each(["file", "symlink", "wrong-origin"] as const)(
    "rejects a managed source %s collision without replacing it",
    async (kind) => {
      const home = await mkdtemp(join(tmpdir(), "cc-bootstrap-collision-"));
      const source = join(home, ".local", "share", "cc-settings", "source");
      const original = join(home, "original-source");
      try {
        await mkdir(dirname(source), { recursive: true });
        if (kind === "file") await writeFile(source, "personal bytes\n");
        else if (kind === "symlink") {
          await mkdir(original);
          await symlink(original, source);
        } else {
          await mkdir(join(source, ".git"), { recursive: true });
        }

        const result = await runRemoteBootstrap(
          home,
          kind === "wrong-origin" ? "https://example.com/not-owned.git" : undefined,
        );

        expect(result.exitCode).not.toBe(0);
        expect(existsSync(join(home, "bootstrap-bun.log"))).toBe(false);
        if (kind === "file") expect(await readFile(source, "utf8")).toBe("personal bytes\n");
        if (kind === "symlink") expect(await realpath(source)).toBe(await realpath(original));
        if (kind === "wrong-origin") expect(existsSync(join(source, ".git"))).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );
});

describe("install E2E — fresh HOME", () => {
  test.each([
    { args: ["--uninstall", "--target=codxe"], target: "claude" as const },
    { args: ["--unknown"], target: "both" as const },
    { args: ["--auto-update=maybe"], target: "both" as const },
  ])("invalid arguments $args fail before either home is mutated", async ({ args, target }) => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-invalid-"));
    try {
      const result = await runInstall(home, [...args], target);
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".claude"))).toBe(false);
      expect(existsSync(join(home, ".codex"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test(
    "first install writes a coherent ~/.claude/ tree",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-"));
      try {
        const result = await runInstall(home, []);
        if (result.exitCode !== 0) {
          throw new Error(
            `installer exited with ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // Top-level files we ship.
        expect(existsSync(join(claudeDir, "settings.json"))).toBe(true);
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(true);

        // Managed directory tree.
        for (const dir of [
          "agents",
          "skills",
          "profiles",
          "rules",
          "hooks",
          "docs",
          "memory",
          "src",
          "src/scripts",
          "src/hooks",
          "src/lib",
          "src/schemas",
        ]) {
          expect(existsSync(join(claudeDir, dir))).toBe(true);
        }

        // settings.json is valid JSON and has the team-baseline fields.
        const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"));
        expect(typeof settings).toBe("object");
        expect(settings.statusLine?.command).toContain("statusline.ts");
        expect(settings.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");

        // Version sentinel was written.
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        );
        expect(typeof sentinel.version).toBe("string");
        expect(sentinel.version).toMatch(/^\d+\.\d+\.\d+$/);

        // First-install delta line should appear.
        expect(result.stdout).toContain("first install at v");

        // No backup yet — fresh HOME has no settings.json to back up.
        const backupsDir = join(claudeDir, "backups");
        if (existsSync(backupsDir)) {
          const stats = await stat(backupsDir);
          expect(stats.isDirectory()).toBe(true);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test("the managed runtime is self-contained, replaces legacy links, and survives source removal", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-source-"));
    try {
      const sourceA = await realpath(await copySourceFixture(join(home, "a")));
      const sourceB = await realpath(await copySourceFixture(join(home, "b")));
      const bin = join(home, "bin");
      const realBun = Bun.which("bun");
      expect(realBun).toBeTruthy();
      await Promise.all([
        mkdir(join(sourceA, "node_modules")),
        mkdir(join(sourceB, "node_modules")),
        mkdir(bin),
      ]);
      await writeFile(
        join(bin, "bun"),
        '#!/bin/sh\nif [ "$1" = "install" ]; then mkdir -p node_modules; cp -R "$REAL_ZOD" node_modules/zod; exit 0; fi\nexec "$REAL_BUN" "$@"\n',
      );
      await chmod(join(bin, "bun"), 0o755);
      const runtime = join(home, ".claude", "src", "node_modules");
      const env = {
        CC_SKIP_DEPS: "0",
        PATH: prependTestPath(bin),
        REAL_BUN: gitBashPath(realBun as string),
        REAL_ZOD: gitBashPath(join(REPO, "node_modules", "zod")),
      };

      const first = await runInstall(home, ["--light"], "claude", env, sourceA);
      expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);
      const firstRuntime = await lstat(runtime);
      expect(firstRuntime.isDirectory()).toBe(true);
      expect(firstRuntime.isSymbolicLink()).toBe(false);
      expect(existsSync(join(runtime, "zod", "package.json"))).toBe(true);

      const managedUpdate = await runInstall(home, ["--light"], "claude", env, sourceB);
      expect(managedUpdate.exitCode, `${managedUpdate.stdout}\n${managedUpdate.stderr}`).toBe(0);
      const rollback = await runInstall(home, ["--rollback"], "claude", env, sourceB);
      expect(rollback.exitCode, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
      expect((await lstat(runtime)).isDirectory()).toBe(true);
      expect((await lstat(runtime)).isSymbolicLink()).toBe(false);

      // A prior release installed this source-owned link. A current update must
      // prove its legacy target from repo_path before replacing it.
      await rm(runtime, { recursive: true, force: true });
      await symlink(join(sourceA, "node_modules"), runtime);

      const update = await runInstall(home, ["--light"], "claude", env, sourceB);
      expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
      const updatedRuntime = await lstat(runtime);
      expect(updatedRuntime.isDirectory()).toBe(true);
      expect(updatedRuntime.isSymbolicLink()).toBe(false);
      expect(
        JSON.parse(await readFile(join(home, ".claude", ".cc-settings-version"), "utf8")).repo_path,
      ).toBe(sourceB);

      await rm(join(home, "a"), { recursive: true, force: true });
      await rm(join(home, "b"), { recursive: true, force: true });
      const verify = Bun.spawn(
        [realBun as string, join(home, ".claude", "src", "hooks", "verify-hooks.ts")],
        {
          env: { ...process.env, HOME: home, USERPROFILE: home },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await verify.exited).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each(["file", "symlink"] as const)(
    "a fresh combined install preserves an unowned node_modules %s and fails before Codex mutation",
    async (kind) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-unowned-"));
      try {
        const source = await copySourceFixture(join(home, "source-parent"));
        await mkdir(join(source, "node_modules"));
        const destination = join(home, ".claude", "src", "node_modules");
        await mkdir(dirname(destination), { recursive: true });
        const outside = join(home, "personal-node-modules");
        if (kind === "file") {
          await writeFile(destination, "unowned node_modules bytes\n");
        } else {
          await mkdir(outside);
          await symlink(outside, destination);
        }

        const install = await runInstall(home, [], "both", {}, source);

        expect(install.exitCode).not.toBe(0);
        expect(`${install.stdout}\n${install.stderr}`).toMatch(
          /collision.*src\/node_modules|src\/node_modules.*collision/i,
        );
        if (kind === "file") {
          expect(await readFile(destination, "utf8")).toBe("unowned node_modules bytes\n");
        } else {
          expect(resolve(dirname(destination), await readlink(destination))).toBe(outside);
        }
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test("a repointed owned node_modules link blocks a combined update before mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-repointed-"));
    try {
      const sourceA = await realpath(await copySourceFixture(join(home, "a")));
      const sourceB = await realpath(await copySourceFixture(join(home, "b")));
      const outside = join(home, "personal-node-modules");
      await Promise.all([
        mkdir(join(sourceA, "node_modules")),
        mkdir(join(sourceB, "node_modules")),
        mkdir(outside),
      ]);
      expect((await runInstall(home, [], "claude", {}, sourceA)).exitCode).toBe(0);
      const destination = join(home, ".claude", "src", "node_modules");
      await rm(destination, { recursive: true, force: true });
      await symlink(outside, destination);
      const sentinel = join(home, ".claude", ".cc-settings-version");
      const sentinelBytes = await readFile(sentinel);

      const update = await runInstall(home, [], "both", {}, sourceB);

      expect(update.exitCode).not.toBe(0);
      expect(`${update.stdout}\n${update.stderr}`).toMatch(
        /Claude managed destination collision: src\/node_modules/i,
      );
      expect(resolve(dirname(destination), await readlink(destination))).toBe(outside);
      expect(await readFile(sentinel)).toEqual(sentinelBytes);
      expect(existsSync(join(home, ".codex"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test("an unmarked runtime directory blocks an update before mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-unmarked-"));
    try {
      const source = await realpath(await copySourceFixture(join(home, "source-parent")));
      await mkdir(join(source, "node_modules"));
      expect((await runInstall(home, [], "claude", {}, source)).exitCode).toBe(0);
      const runtime = join(home, ".claude", "src", "node_modules");
      await mkdir(runtime);
      await writeFile(join(runtime, "personal.txt"), "personal runtime bytes\n");
      const sentinel = join(home, ".claude", ".cc-settings-version");
      const sentinelBytes = await readFile(sentinel);

      const update = await runInstall(home, [], "both", {}, source);

      expect(update.exitCode).not.toBe(0);
      expect(`${update.stdout}\n${update.stderr}`).toMatch(/collision.*src\/node_modules/i);
      expect(await readFile(join(runtime, "personal.txt"), "utf8")).toBe(
        "personal runtime bytes\n",
      );
      expect(await readFile(sentinel)).toEqual(sentinelBytes);
      expect(existsSync(join(home, ".codex"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("runtime dependency installation is production-only, frozen, and script-free", async () => {
    const source = await readFile(join(REPO, "src", "lib", "install-fs.ts"), "utf8");
    expect(source).toContain(
      '["bun", "install", "--production", "--frozen-lockfile", "--ignore-scripts"]',
    );
    expect(source).not.toMatch(/symlink\([^)]*node_modules/);
  });

  test("empty Claude backup archives use an owned portable file list", async () => {
    const source = await readFile(join(REPO, "src", "lib", "install-fs.ts"), "utf8");
    expect(source).not.toMatch(/["'](?:\/dev\/null|NUL)["']/);
    expect(source).toMatch(/--files-from/);
    expect(source).toMatch(/mkdtemp|temporary|empty.*list/i);
  });

  test("an invalid dependency target cannot be treated as a successful managed link", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-invalid-target-"));
    try {
      const source = await realpath(await copySourceFixture(join(home, "source-parent")));
      await writeFile(join(source, "node_modules"), "not a dependency directory\n");

      const install = await runInstall(home, [], "both", {}, source);

      expect(install.exitCode).not.toBe(0);
      expect(`${install.stdout}\n${install.stderr}`).toMatch(
        /node_modules.*directory|directory.*node_modules/i,
      );
      expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
      const codexEntries = await readdir(join(home, ".codex"), { recursive: true }).catch(() => []);
      expect(existsSync(join(home, ".codex")), `Codex entries: ${codexEntries.join(", ")}`).toBe(
        false,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a normal combined install rejects missing source dependencies before Codex or locks", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-node-modules-missing-normal-"));
    try {
      const source = await realpath(await copySourceFixture(join(home, "source-parent")));
      const bin = join(home, "bin");
      await mkdir(bin);
      const realBun = Bun.which("bun");
      expect(realBun).toBeTruthy();
      await writeFile(
        join(bin, "bun"),
        '#!/bin/sh\nif [ "$1" = "install" ]; then touch "$HOME/.dependency-install-called"; exit 1; fi\nexec "$REAL_BUN" "$@"\n',
      );
      await writeFile(
        join(bin, "codex"),
        '#!/bin/sh\ntouch "$HOME/.codex-cli-called"\nprintf \'{"installed":[],"marketplaces":[]}\\n\'\n',
      );
      await Promise.all([chmod(join(bin, "bun"), 0o755), chmod(join(bin, "codex"), 0o755)]);

      const install = await runInstall(
        home,
        [],
        "both",
        {
          CC_SKIP_DEPS: "0",
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(bin),
          REAL_BUN: gitBashPath(realBun as string),
        },
        source,
      );

      expect(install.exitCode).not.toBe(0);
      expect(`${install.stdout}\n${install.stderr}`).toMatch(/node_modules|dependencies/i);
      expect(existsSync(join(home, ".codex-cli-called"))).toBe(false);
      expect(existsSync(join(home, ".dependency-install-called"))).toBe(false);
      expect(existsSync(join(home, ".claude"))).toBe(false);
      expect(existsSync(join(home, ".codex"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("Claude runtime copying ignores arbitrary descendants outside the static manifest", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-static-source-"));
    try {
      const source = await copySourceFixture(home);
      const arbitrary = [
        "agents/personal.md",
        "skills/personal/tmp/junk",
        "docs/personal.md",
        "hooks/personal.ts",
        "config/personal.txt",
        "src/lib/personal.ts",
        "src/lib/.env.local",
        "src/.npmrc",
        "src/secret.pem",
      ];
      for (const path of arbitrary) {
        await mkdir(dirname(join(source, path)), { recursive: true });
        await writeFile(join(source, path), `untracked source artifact: ${path}\n`);
      }

      const install = await runInstall(home, [], "claude", {}, source);

      expect(install.exitCode, `${install.stdout}\n${install.stderr}`).toBe(0);
      const sentinel = JSON.parse(
        await readFile(join(home, ".claude", ".cc-settings-version"), "utf8"),
      ) as { managed_files: Record<string, string> };
      for (const path of arbitrary) {
        expect(existsSync(join(home, ".claude", path)), path).toBe(false);
        expect(sentinel.managed_files[path], path).toBeUndefined();
      }
      expect(existsSync(join(home, ".claude", "src", "setup.ts"))).toBe(true);
      expect(sentinel.managed_files["src/setup.ts"]).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a pre-existing unowned source descendant stays untrusted after install", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-live-source-extra-"));
    const claudeDir = join(home, ".claude");
    const evil = join(claudeDir, "src", "lib", "evil.ts");
    const personal = join(claudeDir, "src", "personal.txt");
    try {
      await mkdir(dirname(evil), { recursive: true });
      await Promise.all([
        writeFile(evil, "export const userControlled = true;\n"),
        writeFile(personal, "personal exact bytes\n"),
      ]);

      const install = await runInstall(home);

      expect(install.exitCode, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(await readFile(evil, "utf8")).toBe("export const userControlled = true;\n");
      expect(await readFile(personal, "utf8")).toBe("personal exact bytes\n");
      const manifest = JSON.parse(
        await readFile(join(claudeDir, ".cc-settings-src-manifest"), "utf8"),
      ) as { files: Record<string, string> };
      expect(manifest.files["lib/evil.ts"]).toBeUndefined();
      expect(manifest.files["setup.ts"]).toMatch(/^[a-f0-9]{64}$/);
      const verification = await verifySrcManifest(claudeDir);
      expect(verification.status).toBe("mismatch");
      expect(verification.changed.map((path) => path.replaceAll("\\", "/"))).toEqual([]);
      expect(verification.unmanifested.map((path) => path.replaceAll("\\", "/"))).toContain(
        "lib/evil.ts",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each(
    (
      [
        ["symlink", "agents/implementer.md"],
        ["wrong-type", "src/setup.ts"],
      ] as const
    ).flatMap(([kind, selectedPath]) =>
      (["claude", "both"] as const).map((target) => [kind, selectedPath, target] as const),
    ),
  )(
    "a selected Claude source %s at %s rejects target %s before product mutation",
    async (kind, selectedPath, target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-e2e-source-${kind}-${target}-`));
      try {
        const source = await copySourceFixture(home);
        const selected = join(source, selectedPath);
        const originalBytes = await readFile(selected);
        await rm(selected);
        if (kind === "symlink") {
          const outside = join(home, "outside-source-file");
          await writeFile(outside, originalBytes);
          await symlink(outside, selected);
        } else {
          await mkdir(selected);
        }

        const install = await runInstall(home, [], target, {}, source);

        expect(install.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test(
    "second install on top of first prints version-delta (or 'no change')",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-"));
      try {
        // Two back-to-back runs against the same HOME. The second is a re-install.
        const first = await runInstall(home);
        expect(first.exitCode).toBe(0);

        const second = await runInstall(home);
        expect(second.exitCode).toBe(0);
        // Same version both runs — delta is silent (per formatVersionDelta).
        // We DO expect the 'Restart Claude Code' line and a re-emitted summary.
        expect(second.stdout).toContain("Installed to:");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 90_000 },
  );

  test("an older packaged source refuses to downgrade either product before state or backups change", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-downgrade-guard-"));
    const claudeDir = join(home, ".claude");
    const codexDir = join(home, ".codex");
    try {
      const first = await runInstall(home, [], "both");
      expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);

      const current = await packagedVersion();
      const installedNewer = neighboringMajor(current, "newer");
      const claudeSentinel = join(claudeDir, ".cc-settings-version");
      const codexSentinel = join(codexDir, ".cc-settings-version");
      await Promise.all([
        rewriteSentinelVersion(claudeSentinel, installedNewer),
        rewriteSentinelVersion(codexSentinel, installedNewer),
      ]);

      const tracked = [
        claudeSentinel,
        join(claudeDir, "settings.json"),
        join(claudeDir, "agents", "implementer.md"),
        codexSentinel,
        join(codexDir, "AGENTS.md"),
        join(codexDir, "darkroom", "source", "package.json"),
      ];
      const stateBefore = await Promise.all(tracked.map((path) => readFile(path)));
      const backupsBefore = await Promise.all([
        directoryEntries(join(claudeDir, "backups")),
        directoryEntries(join(codexDir, "backups", "cc-settings")),
      ]);
      const bin = join(home, "downgrade-bin");
      const backupCommandCalled = join(home, ".downgrade-backup-command-called");
      const realTar = Bun.which("tar");
      expect(realTar).toBeTruthy();
      await mkdir(bin);
      await writeFile(
        join(bin, "tar"),
        '#!/bin/sh\ntouch "$HOME/.downgrade-backup-command-called"\nexec "$REAL_TAR" "$@"\n',
      );
      await chmod(join(bin, "tar"), 0o755);

      const downgrade = await runInstall(home, [], "both", {
        PATH: prependTestPath(bin),
        REAL_TAR: gitBashPath(realTar as string),
      });

      expect(downgrade.exitCode).not.toBe(0);
      expect(`${downgrade.stdout}\n${downgrade.stderr}`).toMatch(
        /installed.*newer|older.*source|downgrade/i,
      );
      expect(existsSync(backupCommandCalled)).toBe(false);
      expect(await Promise.all(tracked.map((path) => readFile(path)))).toEqual(stateBefore);
      expect(
        await Promise.all([
          directoryEntries(join(claudeDir, "backups")),
          directoryEntries(join(codexDir, "backups", "cc-settings")),
        ]),
      ).toEqual(backupsBefore);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each(["claude", "codex"] as const)(
    "%s dry-run refuses an older source without changing product state or backups",
    async (target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-e2e-${target}-dry-run-downgrade-`));
      const productDir = join(home, target === "claude" ? ".claude" : ".codex");
      const sentinel = join(productDir, ".cc-settings-version");
      const productPaths =
        target === "claude"
          ? [
              sentinel,
              join(productDir, "settings.json"),
              join(productDir, "agents", "implementer.md"),
            ]
          : [
              sentinel,
              join(productDir, "AGENTS.md"),
              join(productDir, "darkroom", "source", "package.json"),
            ];
      const backups =
        target === "claude"
          ? join(productDir, "backups")
          : join(productDir, "backups", "cc-settings");
      try {
        const first = await runInstall(home, [], target);
        expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);

        const current = await packagedVersion();
        await rewriteSentinelVersion(sentinel, neighboringMajor(current, "newer"));
        const stateBefore = await Promise.all(productPaths.map((path) => readFile(path)));
        const backupsBefore = await directoryEntries(backups);

        const dryRun = await runInstall(home, ["--dry-run"], target);

        expect(dryRun.exitCode).not.toBe(0);
        expect(`${dryRun.stdout}\n${dryRun.stderr}`).toMatch(
          /installed.*newer|older.*source|downgrade/i,
        );
        expect(await Promise.all(productPaths.map((path) => readFile(path)))).toEqual(stateBefore);
        expect(await directoryEntries(backups)).toEqual(backupsBefore);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("a newer packaged source remains a normal supported upgrade", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-upgrade-guard-"));
    const sentinelPath = join(home, ".claude", ".cc-settings-version");
    try {
      const first = await runInstall(home);
      expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);

      const current = await packagedVersion();
      await rewriteSentinelVersion(sentinelPath, neighboringMajor(current, "older"));

      const upgrade = await runInstall(home);

      expect(upgrade.exitCode, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);
      expect(JSON.parse(await readFile(sentinelPath, "utf8")).version).toBe(current);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("an explicit rollback remains available when installed metadata is newer than the source", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-explicit-rollback-"));
    const sentinelPath = join(home, ".claude", ".cc-settings-version");
    try {
      const first = await runInstall(home);
      expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);
      const second = await runInstall(home);
      expect(second.exitCode, `${second.stdout}\n${second.stderr}`).toBe(0);

      const current = await packagedVersion();
      await rewriteSentinelVersion(sentinelPath, neighboringMajor(current, "newer"));

      const rollback = await runInstall(home, ["--rollback"]);

      expect(rollback.exitCode, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
      expect(JSON.parse(await readFile(sentinelPath, "utf8")).version).toBe(current);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test("full reinstall preserves personal files in every shared managed directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-reinstall-personal-"));
    const claudeDir = join(home, ".claude");
    const personal = new Map([
      [join(claudeDir, "agents", "personal.md"), "personal agent\n"],
      [join(claudeDir, "rules", "personal.md"), "personal rule\n"],
      [join(claudeDir, "profiles", "personal.md"), "personal profile\n"],
      [join(claudeDir, "docs", "personal.md"), "personal docs\n"],
      [join(claudeDir, "hooks", "personal.ts"), "personal hook\n"],
      [join(claudeDir, "skills", "personal", "SKILL.md"), "personal skill\n"],
    ]);
    try {
      expect((await runInstall(home)).exitCode).toBe(0);
      for (const [path, bytes] of personal) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }

      const reinstall = await runInstall(home);

      expect(reinstall.exitCode, `${reinstall.stdout}\n${reinstall.stderr}`).toBe(0);
      for (const [path, bytes] of personal) expect(await readFile(path, "utf8"), path).toBe(bytes);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a modified Claude-owned file blocks combined reinstall before either product changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-modified-owned-both-"));
    const claudeDir = join(home, ".claude");
    const codexDir = join(home, ".codex");
    const modified = join(claudeDir, "agents", "implementer.md");
    try {
      expect((await runInstall(home, [], "both")).exitCode).toBe(0);
      await writeFile(modified, "user-modified managed agent\n");
      const tracked = [
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "settings.json"),
        modified,
        join(codexDir, ".cc-settings-version"),
        join(codexDir, "AGENTS.md"),
        join(codexDir, "agents", "implementer.toml"),
      ];
      const before = new Map(
        await Promise.all(
          tracked.map(async (path) => [path, (await readFile(path)).toString("base64")] as const),
        ),
      );

      const reinstall = await runInstall(home, [], "both");

      expect(reinstall.exitCode).not.toBe(0);
      for (const [path, bytes] of before) {
        expect((await readFile(path)).toString("base64"), path).toBe(bytes);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each(["light", "uninstall"] as const)(
    "modified Claude ownership makes combined %s fail before either product mutates",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-light-modified-owned-"));
      const claudeDir = join(home, ".claude");
      const modifiedRelative = "agents/implementer.md";
      const modified = join(claudeDir, modifiedRelative);
      const modifiedBytes = "user-modified managed agent\n";
      try {
        expect((await runInstall(home, [], "both")).exitCode).toBe(0);
        await writeFile(modified, modifiedBytes);
        const tracked = [
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          modified,
          join(home, ".codex", ".cc-settings-version"),
          join(home, ".codex", "AGENTS.md"),
        ];
        const before = await Promise.all(tracked.map((path) => readFile(path)));

        const result = await runInstall(
          home,
          operation === "light" ? ["--light"] : ["--uninstall"],
          "both",
        );

        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/modified|changed|hash|owned/i);
        expect(await Promise.all(tracked.map((path) => readFile(path)))).toEqual(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test(
    "--migrate-only against a fresh HOME applies merger only (no dependencies, no file copy)",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-mig-"));
      try {
        const proc = Bun.spawn(
          [process.execPath, SETUP_TS, `--source=${REPO}`, "--target=claude", "--migrate-only"],
          {
            env: {
              ...process.env,
              HOME: home,
              USERPROFILE: home,
              CC_SKIP_DEPS: "1",
              CC_SKIP_SCHEDULE: "1",
              NO_COLOR: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;
        if (code !== 0) {
          throw new Error(`migrate-only failed (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        }

        // settings.json + sentinel exist (merger + sentinel ran).
        expect(existsSync(join(home, ".claude", "settings.json"))).toBe(true);
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(true);
        const migratedSentinel = JSON.parse(
          await readFile(join(home, ".claude", ".cc-settings-version"), "utf8"),
        ) as Record<string, unknown>;
        expect(migratedSentinel.managed_files).toBeUndefined();
        expect(migratedSentinel.managed_files_manifest_version).toBeUndefined();

        // CLAUDE.md was NOT copied (file-copy phase was skipped).
        expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false);

        // The migrate-only banner appears in stdout.
        expect(stdout).toContain("Migrate-only");

        const full = await runInstall(home);
        expect(full.exitCode, `${full.stdout}\n${full.stderr}`).toBe(0);
        const fullSentinel = JSON.parse(
          await readFile(join(home, ".claude", ".cc-settings-version"), "utf8"),
        ) as {
          managed_files: Record<string, string>;
          managed_files_manifest_version: number;
        };
        expect(fullSentinel.managed_files_manifest_version).toBe(
          CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
        );
        expect(Object.keys(fullSentinel.managed_files).sort()).toEqual(
          [...(await claudeManagedAllowedPaths(REPO, "full"))].sort(),
        );
        for (const hash of Object.values(fullSentinel.managed_files)) {
          expect(hash).toMatch(/^[a-f0-9]{64}$/);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test("migrate-only preserves a real historical sentinel without inventing ownership", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-migrate-legacy-"));
    const claudeDir = join(home, ".claude");
    const sentinelPath = join(claudeDir, ".cc-settings-version");
    try {
      const { source, version } = await createHistoricalSourceFixture(home);
      await installHistoricalClaudeFiles(home, source, version);
      const legacy = {
        version,
        installed_at: "2025-01-01T00:00:00.000Z",
        repo_path: source,
        profile: "full",
        engine: "native-ts",
        engine_explicit: false,
      };
      await writeFile(sentinelPath, `${JSON.stringify(legacy, null, 2)}\n`);

      const migrate = await runInstall(home, ["--migrate-only"], "claude", {}, source);
      expect(migrate.exitCode, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
      const migrated = JSON.parse(await readFile(sentinelPath, "utf8")) as Record<string, unknown>;
      expect(migrated.managed_files).toBeUndefined();
      expect(migrated.managed_files_manifest_version).toBeUndefined();

      const full = await runInstall(home, [], "claude", {}, source);
      expect(full.exitCode, `${full.stdout}\n${full.stderr}`).toBe(0);
      const upgraded = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
        managed_files_manifest_version: number;
      };
      expect(upgraded.managed_files_manifest_version).toBe(
        CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
      );
      expect(Object.keys(upgraded.managed_files).sort()).toEqual(
        [...(await claudeManagedAllowedPaths(source, "full"))].sort(),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each([false, true])(
    "a real committed no-map install upgrades safely after migrate-only=%s",
    async (migrateOnlyFirst) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-historical-no-map-"));
      const claudeDir = join(home, ".claude");
      const sentinelPath = join(claudeDir, ".cc-settings-version");
      try {
        const { source, version } = await createHistoricalSourceFixture(home);
        const historical = await installHistoricalClaudeFiles(home, source, version);
        const historicalSkill = join(claudeDir, "skills", "cc", "SKILL.md");
        const historicalSkillBytes = await readFile(historicalSkill);
        const currentSkillBytes = await readFile(join(source, "skills", "cc", "SKILL.md"));
        expect(historicalSkillBytes).not.toEqual(currentSkillBytes);
        const personalAgent = join(claudeDir, "agents", "personal.md");
        const personalSkill = join(claudeDir, "skills", "personal", "SKILL.md");
        await mkdir(dirname(personalSkill), { recursive: true });
        await Promise.all([
          writeFile(personalAgent, "personal agent exact bytes\n"),
          writeFile(personalSkill, "personal skill exact bytes\n"),
          writeFile(
            sentinelPath,
            `${JSON.stringify(
              {
                version,
                installed_at: "2026-01-01T00:00:00.000Z",
                repo_path: source,
                profile: "full",
                engine: "native-ts",
                engine_explicit: false,
                mcp_written: {},
                auto_update: false,
              },
              null,
              2,
            )}\n`,
          ),
        ]);

        if (migrateOnlyFirst) {
          const migrate = await runInstall(home, ["--migrate-only"], "claude", {}, source);
          expect(migrate.exitCode, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
          const migrated = JSON.parse(await readFile(sentinelPath, "utf8")) as Record<
            string,
            unknown
          >;
          expect(migrated.version).toBe(version);
          expect(migrated.managed_files).toBeUndefined();
          expect(migrated.managed_files_manifest_version).toBeUndefined();
        }

        const legacySentinelBytes = await readFile(sentinelPath);
        const backupsBeforeUpdate = new Set(
          await readdir(join(claudeDir, "backups")).catch(() => []),
        );
        const update = await runInstall(home, [], "claude", {}, source);
        expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
        expect(await readFile(historicalSkill)).toEqual(currentSkillBytes);
        expect(await readFile(personalAgent, "utf8")).toBe("personal agent exact bytes\n");
        expect(await readFile(personalSkill, "utf8")).toBe("personal skill exact bytes\n");
        const upgraded = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_files: Record<string, string>;
          managed_files_manifest_version: number;
        };
        const currentPaths = [...(await claudeManagedAllowedPaths(source, "full"))].sort();
        expect(upgraded.managed_files_manifest_version).toBe(
          CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
        );
        expect(Object.keys(upgraded.managed_files).sort()).toEqual(currentPaths);
        for (const retired of historical.destinations.filter(
          (path) => !currentPaths.includes(path),
        )) {
          expect(existsSync(join(claudeDir, retired)), retired).toBe(false);
        }
        const legacyBackup = (await readdir(join(claudeDir, "backups"))).find(
          (name) => /^backup-.*\.tar\.gz$/.test(name) && !backupsBeforeUpdate.has(name),
        );
        expect(legacyBackup).toBeDefined();
        const legacyBackupId = (legacyBackup as string).replace(/^backup-|\.tar\.gz$/g, "");
        const rollback = await runInstall(
          home,
          [`--rollback=${legacyBackupId}`],
          "claude",
          {},
          source,
        );
        expect(rollback.exitCode, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
        expect(await readFile(sentinelPath)).toEqual(legacySentinelBytes);
        expect(await readFile(historicalSkill)).toEqual(historicalSkillBytes);
        expect(await readFile(personalAgent, "utf8")).toBe("personal agent exact bytes\n");
        expect(await readFile(personalSkill, "utf8")).toBe("personal skill exact bytes\n");
        const futureUpdate = await runInstall(home, [], "claude", {}, source);
        expect(futureUpdate.exitCode, `${futureUpdate.stdout}\n${futureUpdate.stderr}`).toBe(0);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.each(
    (["modified", "deleted"] as const).flatMap((mutation) =>
      (["full", "migrate-only"] as const).map((operation) => [mutation, operation] as const),
    ),
  )(
    "a %s retired historical file blocks %s before mutation",
    async (mutation, operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-e2e-historical-${mutation}-${operation}-`));
      const claudeDir = join(home, ".claude");
      try {
        const { source, version } = await createHistoricalSourceFixture(home);
        const historical = await installHistoricalClaudeFiles(home, source, version);
        expect(historical.destinations).toContain("rules/retired-legacy.md");
        const sentinel = join(claudeDir, ".cc-settings-version");
        const retired = join(claudeDir, "rules", "retired-legacy.md");
        const personal = join(claudeDir, "agents", "personal.md");
        await Promise.all([
          writeFile(
            sentinel,
            `${JSON.stringify({ version, repo_path: source, profile: "full" }, null, 2)}\n`,
          ),
          writeFile(personal, "personal exact bytes\n"),
        ]);
        if (mutation === "modified") await writeFile(retired, "user changed retired bytes\n");
        else await rm(retired);
        const before = await Promise.all([
          readFile(sentinel),
          readFile(retired).catch(() => null),
          readFile(personal),
        ]);

        const update = await runInstall(
          home,
          operation === "migrate-only" ? ["--migrate-only"] : [],
          "both",
          {},
          source,
        );

        expect(update.exitCode).not.toBe(0);
        expect(`${update.stdout}\n${update.stderr}`).toMatch(
          /destination collision|historical|changed|missing/i,
        );
        expect(
          await Promise.all([
            readFile(sentinel),
            readFile(retired).catch(() => null),
            readFile(personal),
          ]),
        ).toEqual(before);
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each([
    ["unresolved", "0.0.0-unresolved", 0, /does not resolve to exactly one/i],
    // A superseded version raw-matches two commits (intro + the release that
    // removed it); the resolver filters to the single true carrier, so the
    // upgrade proceeds past resolution and fail-closes on the unrestored files.
    ["superseded-but-unrestored", "13.13.0", 2, /Historical Claude managed file is missing/i],
  ] as const)(
    "%s legacy version fails before a combined upgrade mutates either product",
    async (_case, version, expectedCommitCount, expectedError) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-historical-version-"));
      const claudeDir = join(home, ".claude");
      try {
        expect((await historicalCommit(REPO, version)).length).toBe(expectedCommitCount);
        await mkdir(claudeDir);
        const sentinel = join(claudeDir, ".cc-settings-version");
        const personal = join(claudeDir, "personal.txt");
        const sentinelBytes = `${JSON.stringify({ version, repo_path: REPO, profile: "full" })}\n`;
        await Promise.all([
          writeFile(sentinel, sentinelBytes),
          writeFile(personal, "personal exact bytes\n"),
        ]);

        const update = await runInstall(home, [], "both");

        expect(update.exitCode).not.toBe(0);
        expect(`${update.stdout}\n${update.stderr}`).toMatch(expectedError);
        expect(await readFile(sentinel, "utf8")).toBe(sentinelBytes);
        expect(await readFile(personal, "utf8")).toBe("personal exact bytes\n");
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test("migrate-only rejects a changed generated file before ownership mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-migrate-versioned-"));
    const claudeDir = join(home, ".claude");
    const sentinelPath = join(claudeDir, ".cc-settings-version");
    const generatedPath = join(claudeDir, ".cc-settings-hooks-fingerprint");
    try {
      expect((await runInstall(home)).exitCode).toBe(0);
      const sentinelBytes = await readFile(sentinelPath);
      await writeFile(generatedPath, "user-changed generated bytes\n");

      const migrate = await runInstall(home, ["--migrate-only"]);
      expect(migrate.exitCode).not.toBe(0);
      expect(`${migrate.stdout}\n${migrate.stderr}`).toMatch(
        /managed file is missing or modified/i,
      );
      expect(await readFile(sentinelPath)).toEqual(sentinelBytes);
      expect(await readFile(generatedPath, "utf8")).toBe("user-changed generated bytes\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test(
    "--migrate-only rejects Codex-only and treats both targets as Claude-only",
    async () => {
      const codexOnlyHome = await mkdtemp(join(tmpdir(), "cc-e2e-mig-codex-"));
      const bothHome = await mkdtemp(join(tmpdir(), "cc-e2e-mig-both-"));
      try {
        const codexOnly = await runInstall(codexOnlyHome, ["--migrate-only"], "codex");
        expect(codexOnly.exitCode).not.toBe(0);
        expect(existsSync(join(codexOnlyHome, ".claude"))).toBe(false);
        expect(existsSync(join(codexOnlyHome, ".codex"))).toBe(false);

        const both = await runInstall(bothHome, ["--migrate-only"], "both");
        if (both.exitCode !== 0) {
          throw new Error(
            `both-target migrate-only failed (${both.exitCode})\nstdout:\n${both.stdout}\nstderr:\n${both.stderr}`,
          );
        }
        expect(existsSync(join(bothHome, ".claude", "settings.json"))).toBe(true);
        expect(existsSync(join(bothHome, ".claude", ".cc-settings-version"))).toBe(true);
        expect(existsSync(join(bothHome, ".claude", "CLAUDE.md"))).toBe(false);
        for (const codexManagedPath of [
          ".cc-settings-version",
          "AGENTS.md",
          "darkroom/source",
          "agents/implementer.toml",
          "rules/darkroom.rules",
        ]) {
          expect(existsSync(join(bothHome, ".codex", codexManagedPath))).toBe(false);
        }
      } finally {
        await Promise.all([
          rm(codexOnlyHome, { recursive: true, force: true }),
          rm(bothHome, { recursive: true, force: true }),
        ]);
      }
    },
    { timeout: 90_000 },
  );
});

describe("install E2E — uninstall ownership", () => {
  test.skipIf(process.platform !== "darwin")(
    "a paired managed-absent Claude snapshot is a no-op until a later managed install exists",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-claude-managed-absent-"));
      const claudeDir = join(home, ".claude");
      const codexDir = join(home, ".codex");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        const bin = join(home, "bin");
        await Promise.all([mkdir(bin), mkdir(claudeDir)]);
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const scheduleEnv = {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };
        const settings = join(claudeDir, "settings.json");
        const globalConfig = join(home, ".claude.json");
        const personal = join(claudeDir, "personal.txt");
        await Promise.all([
          writeFile(settings, `${JSON.stringify({ personalSetting: "before" })}\n`),
          writeFile(globalConfig, `${JSON.stringify({ personalGlobal: "before" })}\n`),
          writeFile(personal, "personal before snapshot\n"),
        ]);
        const absentSnapshot = new Map(
          await Promise.all(
            [settings, globalConfig, personal, plist, loaded].map(
              async (path) => [path, await readFile(path).catch(() => null)] as const,
            ),
          ),
        );

        expect((await runInstall(home, ["--light"], "codex", scheduleEnv)).exitCode).toBe(0);
        expect((await runInstall(home, ["--uninstall"], "both", scheduleEnv)).exitCode).toBe(0);
        const claudeBackups = (await readdir(join(claudeDir, "backups")))
          .map((name) => name.match(/^backup-(.+)\.tar\.gz$/)?.[1])
          .filter((id): id is string => id !== undefined);
        const codexBackups = new Set(await readdir(join(codexDir, "backups", "cc-settings")));
        const backupId = claudeBackups.find((id) => codexBackups.has(id));
        expect(backupId).toBeDefined();
        const archive = join(claudeDir, "backups", `backup-${backupId}.tar.gz`);
        expect(JSON.parse(await readFile(`${archive}.state.json`, "utf8"))).toEqual(
          expect.objectContaining({ restore_scope: "managed-absent", present: [] }),
        );

        const immediate = await runInstall(home, [`--rollback=${backupId}`], "both", scheduleEnv);
        expect(immediate.exitCode, `${immediate.stdout}\n${immediate.stderr}`).toBe(0);
        for (const [path, bytes] of absentSnapshot) {
          const current = await readFile(path).catch(() => null);
          expect(current, path).toEqual(bytes);
        }

        const installClaude = await runInstall(home, ["--auto-update=on"], "claude", scheduleEnv);
        expect(installClaude.exitCode, `${installClaude.stdout}\n${installClaude.stderr}`).toBe(0);
        expect(existsSync(plist)).toBe(true);
        expect(existsSync(loaded)).toBe(true);
        const mergedSettings = JSON.parse(await readFile(settings, "utf8")) as Record<
          string,
          unknown
        >;
        mergedSettings.postSnapshot = "preserve";
        await writeFile(settings, `${JSON.stringify(mergedSettings, null, 2)}\n`);
        const afterPersonal = join(claudeDir, "personal-after.txt");
        await writeFile(afterPersonal, "personal after snapshot\n");

        const rollback = await runInstall(home, [`--rollback=${backupId}`], "both", scheduleEnv);
        expect(rollback.exitCode, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        expect(existsSync(join(claudeDir, "src"))).toBe(false);
        expect(existsSync(plist)).toBe(false);
        expect(existsSync(loaded)).toBe(false);
        expect(await readFile(personal, "utf8")).toBe("personal before snapshot\n");
        expect(await readFile(afterPersonal, "utf8")).toBe("personal after snapshot\n");
        expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(
          expect.objectContaining({ personalSetting: "before", postSnapshot: "preserve" }),
        );
        expect(JSON.parse(await readFile(globalConfig, "utf8"))).toEqual(
          expect.objectContaining({ personalGlobal: "before" }),
        );
        expect(existsSync(join(codexDir, ".cc-settings-version"))).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test("a modified currently owned Claude file blocks paired rollback before Codex mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-rollback-modified-claude-"));
    const claudeDir = join(home, ".claude");
    const codexDir = join(home, ".codex");
    try {
      expect((await runInstall(home, ["--light"], "both")).exitCode).toBe(0);
      expect((await runInstall(home, ["--light"], "both")).exitCode).toBe(0);
      const claudeIds = (await readdir(join(claudeDir, "backups")))
        .map((name) => name.match(/^backup-(.+)\.tar\.gz$/)?.[1])
        .filter((id): id is string => id !== undefined);
      const codexIds = new Set(await readdir(join(codexDir, "backups", "cc-settings")));
      const backupId = claudeIds
        .filter((id) => codexIds.has(id))
        .sort()
        .at(-1);
      expect(backupId).toBeDefined();
      const modified = join(claudeDir, "skills", "share-learning", "SKILL.md");
      await writeFile(modified, "user modified currently owned skill\n");
      const tracked = [
        join(claudeDir, ".cc-settings-version"),
        modified,
        join(codexDir, ".cc-settings-version"),
        join(codexDir, "AGENTS.md"),
      ];
      const before = await Promise.all(tracked.map((path) => readFile(path)));

      const rollback = await runInstall(home, [`--rollback=${backupId}`], "both");

      expect(rollback.exitCode).not.toBe(0);
      expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(/modified managed content/i);
      expect(await Promise.all(tracked.map((path) => readFile(path)))).toEqual(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.skipIf(process.platform !== "darwin")(
    "missing product sentinels make combined uninstall preserve the unowned product exactly",
    async () => {
      const noClaudeSentinelHome = await mkdtemp(join(tmpdir(), "cc-e2e-no-claude-sentinel-"));
      const noCodexSentinelHome = await mkdtemp(join(tmpdir(), "cc-e2e-no-codex-sentinel-"));
      const seedUnownedClaude = async (home: string): Promise<Map<string, string>> => {
        const claude = join(home, ".claude");
        const plist = join(
          home,
          "Library",
          "LaunchAgents",
          "com.darkroom.cc-settings-autoupdate.plist",
        );
        const paths = [
          join(claude, "CLAUDE.md"),
          join(claude, "AGENTS.md"),
          join(claude, "skills", "fix", "SKILL.md"),
          join(claude, "settings.json"),
          join(home, ".claude.json"),
          plist,
          join(home, ".fake-launchctl-loaded"),
        ];
        await Promise.all([
          mkdir(join(claude, "skills", "fix"), { recursive: true }),
          mkdir(dirname(plist), { recursive: true }),
        ]);
        await Promise.all([
          writeFile(paths[0] as string, "# user CLAUDE lookalike\n"),
          writeFile(paths[1] as string, "# user AGENTS lookalike\n"),
          writeFile(paths[2] as string, "---\nname: fix\n---\nuser skill\n"),
          writeFile(
            paths[3] as string,
            `${JSON.stringify({ mcpServers: { context7: { command: "user-context7" } } })}\n`,
          ),
          writeFile(
            paths[4] as string,
            `${JSON.stringify({ mcpServers: { figma: { command: "user-figma" } } })}\n`,
          ),
          writeFile(paths[5] as string, "user launch agent bytes\n"),
          writeFile(paths[6] as string, "loaded\n"),
        ]);
        return new Map(
          await Promise.all(
            paths.map(async (path) => [path, (await readFile(path)).toString("base64")] as const),
          ),
        );
      };
      const fakeLaunchctlEnv = async (home: string): Promise<Record<string, string>> => {
        const bin = join(home, "bin");
        await mkdir(bin, { recursive: true });
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; exit 1;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) printf \'loaded\\n\' > "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        return {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };
      };
      const backupIds = async (
        home: string,
      ): Promise<{ claude: Set<string>; codex: Set<string> }> => ({
        claude: new Set(
          (await readdir(join(home, ".claude", "backups")).catch(() => []))
            .map((name) => name.match(/^backup-(.+)\.tar\.gz$/)?.[1])
            .filter((id): id is string => id !== undefined),
        ),
        codex: new Set(
          (await readdir(join(home, ".codex", "backups", "cc-settings")).catch(() => [])).filter(
            (name) => /^\d{14}-\d{3}-\d+-\d+$/.test(name),
          ),
        ),
      });
      try {
        expect((await runInstall(noClaudeSentinelHome, [], "codex")).exitCode).toBe(0);
        const claudeBefore = await seedUnownedClaude(noClaudeSentinelHome);
        const env = await fakeLaunchctlEnv(noClaudeSentinelHome);
        const idsBeforeCodexUninstall = await backupIds(noClaudeSentinelHome);
        const asymmetricUninstall = await runInstall(
          noClaudeSentinelHome,
          ["--uninstall"],
          "both",
          env,
        );
        expect(
          asymmetricUninstall.exitCode,
          `${asymmetricUninstall.stdout}\n${asymmetricUninstall.stderr}`,
        ).toBe(0);
        for (const [path, bytes] of claudeBefore) {
          expect((await readFile(path)).toString("base64")).toBe(bytes);
        }
        expect(existsSync(join(noClaudeSentinelHome, ".codex", ".cc-settings-version"))).toBe(
          false,
        );
        const launchctlCalls = await readFile(
          join(noClaudeSentinelHome, ".fake-launchctl-calls"),
          "utf8",
        );
        expect(launchctlCalls).toContain("print");
        expect(launchctlCalls).not.toMatch(/bootout|bootstrap/);
        const idsAfterCodexUninstall = await backupIds(noClaudeSentinelHome);
        const newClaudeIds = [...idsAfterCodexUninstall.claude].filter(
          (id) => !idsBeforeCodexUninstall.claude.has(id),
        );
        const newCodexIds = [...idsAfterCodexUninstall.codex].filter(
          (id) => !idsBeforeCodexUninstall.codex.has(id),
        );
        expect(newClaudeIds).toEqual(newCodexIds);
        expect(newClaudeIds).toHaveLength(1);
        expect((await runInstall(noClaudeSentinelHome, ["--rollback"], "both", env)).exitCode).toBe(
          0,
        );
        expect(existsSync(join(noClaudeSentinelHome, ".codex", ".cc-settings-version"))).toBe(true);
        for (const [path, bytes] of claudeBefore) {
          expect((await readFile(path)).toString("base64")).toBe(bytes);
        }
        expect(
          (await runInstall(noClaudeSentinelHome, ["--uninstall"], "both", env)).exitCode,
        ).toBe(0);
        const explicitPairs = await backupIds(noClaudeSentinelHome);
        const explicitId = [...explicitPairs.claude]
          .filter((id) => explicitPairs.codex.has(id))
          .sort()
          .at(-1);
        expect(explicitId).toBeDefined();
        expect(
          (await runInstall(noClaudeSentinelHome, [`--rollback=${explicitId}`], "both", env))
            .exitCode,
        ).toBe(0);
        expect(existsSync(join(noClaudeSentinelHome, ".codex", ".cc-settings-version"))).toBe(true);

        expect((await runInstall(noCodexSentinelHome)).exitCode).toBe(0);
        const codexPaths = [
          join(noCodexSentinelHome, ".codex", "AGENTS.md"),
          join(noCodexSentinelHome, ".codex", "darkroom", "source", "personal.txt"),
        ];
        await mkdir(dirname(codexPaths[1] as string), { recursive: true });
        await Promise.all([
          writeFile(codexPaths[0] as string, "unowned Codex instructions\n"),
          writeFile(codexPaths[1] as string, "unowned Codex source\n"),
        ]);
        const codexBefore = new Map(
          await Promise.all(
            codexPaths.map(
              async (path) => [path, (await readFile(path)).toString("base64")] as const,
            ),
          ),
        );
        const idsBeforeClaudeUninstall = await backupIds(noCodexSentinelHome);
        expect((await runInstall(noCodexSentinelHome, ["--uninstall"], "both")).exitCode).toBe(0);
        for (const [path, bytes] of codexBefore) {
          expect((await readFile(path)).toString("base64")).toBe(bytes);
        }
        expect(existsSync(join(noCodexSentinelHome, ".claude", ".cc-settings-version"))).toBe(
          false,
        );
        const idsAfterClaudeUninstall = await backupIds(noCodexSentinelHome);
        const newClaudePairIds = [...idsAfterClaudeUninstall.claude].filter(
          (id) => !idsBeforeClaudeUninstall.claude.has(id),
        );
        const newEmptyCodexIds = [...idsAfterClaudeUninstall.codex].filter(
          (id) => !idsBeforeClaudeUninstall.codex.has(id),
        );
        expect(newClaudePairIds).toEqual(newEmptyCodexIds);
        expect(newClaudePairIds).toHaveLength(1);
        const claudeRollback = await runInstall(noCodexSentinelHome, ["--rollback"], "both");
        expect(claudeRollback.exitCode, `${claudeRollback.stdout}\n${claudeRollback.stderr}`).toBe(
          0,
        );
        expect(existsSync(join(noCodexSentinelHome, ".claude", ".cc-settings-version"))).toBe(true);
        for (const [path, bytes] of codexBefore) {
          expect((await readFile(path)).toString("base64")).toBe(bytes);
        }
      } finally {
        await Promise.all([
          rm(noClaudeSentinelHome, { recursive: true, force: true }),
          rm(noCodexSentinelHome, { recursive: true, force: true }),
        ]);
      }
    },
    240_000,
  );

  test.each([
    ["malformed JSON", "{not json", "claude"],
    ["primitive", "42", "claude"],
    ["array", "[]", "claude"],
    ["invalid profile", JSON.stringify({ profile: "custom" }), "claude"],
    ["non-object mcp_written", JSON.stringify({ mcp_written: [] }), "claude"],
    ["non-object managed_files", JSON.stringify({ managed_files: [] }), "claude"],
    ["invalid managed hash", JSON.stringify({ managed_files: { "agents/a.md": "bad" } }), "claude"],
    [
      "unsafe managed path",
      JSON.stringify({ managed_files: { "../escape": "a".repeat(64) } }),
      "both",
    ],
  ] as const)(
    "strict sentinel rejects %s before uninstall mutates either product",
    async (_label, sentinelBytes, target) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-strict-sentinel-"));
      const claudeDir = join(home, ".claude");
      const codexDir = join(home, ".codex");
      try {
        await Promise.all([
          mkdir(claudeDir, { recursive: true }),
          mkdir(codexDir, { recursive: true }),
        ]);
        const sentinelPath = join(claudeDir, ".cc-settings-version");
        const personalPath = join(claudeDir, "personal.txt");
        const codexMarker = join(codexDir, "personal.txt");
        await Promise.all([
          writeFile(sentinelPath, sentinelBytes),
          writeFile(personalPath, "claude exact bytes\n"),
          writeFile(codexMarker, "codex exact bytes\n"),
        ]);

        const result = await runInstall(home, ["--uninstall"], target);
        expect(result.exitCode).not.toBe(0);
        expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
        expect(await readFile(personalPath, "utf8")).toBe("claude exact bytes\n");
        expect(await readFile(codexMarker, "utf8")).toBe("codex exact bytes\n");
        expect(existsSync(join(claudeDir, "tmp"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test(
    "uninstall removes the Claude footprint while preserving user files and backup history",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-uninstall-"));
      const claudeDir = join(home, ".claude");
      const userSettings = { personalSetting: "keep exactly" };
      const userClaudeJson = {
        mcpServers: {
          personal: { command: "personal-mcp", args: ["--keep"] },
        },
      };
      const personalFiles = new Map([
        [join(claudeDir, "agents", "personal.md"), "personal agent\nsecond line\n"],
        [join(claudeDir, "rules", "personal.md"), "# personal rule\n"],
        [join(claudeDir, "skills", "personal", "SKILL.md"), "# Personal skill\n"],
        [join(claudeDir, "output-styles", "personal.md"), "personal style bytes\n"],
      ]);

      try {
        await mkdir(claudeDir, { recursive: true });
        await writeFile(join(claudeDir, "settings.json"), `${JSON.stringify(userSettings)}\n`);
        await writeFile(join(home, ".claude.json"), `${JSON.stringify(userClaudeJson)}\n`);

        const install = await runInstall(home);
        if (install.exitCode !== 0) {
          throw new Error(
            `full installer failed (${install.exitCode})\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`,
          );
        }

        const backupsDir = join(claudeDir, "backups");
        const backupsBefore = await readdir(backupsDir);
        expect(backupsBefore.length).toBeGreaterThan(0);

        const sentinelPath = join(claudeDir, ".cc-settings-version");
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_files?: Record<string, string>;
        };
        expect(Object.keys(sentinel.managed_files ?? {}).length).toBeGreaterThan(0);
        for (const [path, hash] of Object.entries(sentinel.managed_files ?? {})) {
          expect(path.startsWith("/")).toBe(false);
          expect(path.split(/[\\/]+/)).not.toContain("..");
          expect(hash).toMatch(/^[a-f0-9]{64}$/);
        }

        for (const [path, bytes] of personalFiles) {
          await mkdir(resolve(path, ".."), { recursive: true });
          await writeFile(path, bytes);
        }

        const driftedRule = join(claudeDir, "rules", "future-source.md");
        const driftedRuleBytes = "# newer source-owned name, not owned by this sentinel\n";
        await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);
        await writeFile(driftedRule, driftedRuleBytes);

        const claudeJson = JSON.parse(await readFile(join(home, ".claude.json"), "utf8")) as {
          mcpServers: Record<string, unknown>;
        };
        const userFigma = { type: "http", url: "https://user.example/mcp" };
        claudeJson.mcpServers.figma = userFigma;
        await writeFile(join(home, ".claude.json"), `${JSON.stringify(claudeJson)}\n`);

        for (const managedPath of [
          "CLAUDE.md",
          "AGENTS.md",
          "src",
          ".cc-settings-version",
          "agents/reviewer.md",
          "skills/fix/SKILL.md",
          "rules/security.md",
          "output-styles/darkroom.md",
        ]) {
          expect(existsSync(join(claudeDir, managedPath)), `${managedPath} must be installed`).toBe(
            true,
          );
        }

        const uninstall = await runInstall(home, ["--uninstall"]);
        if (uninstall.exitCode !== 0) {
          throw new Error(
            `uninstall failed (${uninstall.exitCode})\nstdout:\n${uninstall.stdout}\nstderr:\n${uninstall.stderr}`,
          );
        }

        for (const managedPath of [
          "CLAUDE.md",
          "AGENTS.md",
          "src",
          ".cc-settings-version",
          "agents/reviewer.md",
          "skills/fix",
          "rules/security.md",
          "output-styles/darkroom.md",
        ]) {
          expect(existsSync(join(claudeDir, managedPath)), `${managedPath} must be removed`).toBe(
            false,
          );
        }
        for (const [path, bytes] of personalFiles) {
          expect(await readFile(path, "utf8")).toBe(bytes);
        }
        expect(await readFile(driftedRule, "utf8")).toBe(driftedRuleBytes);

        expect(JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"))).toEqual(
          userSettings,
        );
        expect(JSON.parse(await readFile(join(home, ".claude.json"), "utf8"))).toEqual({
          mcpServers: { ...userClaudeJson.mcpServers, figma: userFigma },
        });
        expect(await readdir(backupsDir)).toEqual(backupsBefore);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 90_000 },
  );

  test.each([
    ["projects/user-data.json", "claude"],
    ["output-styles/personal.md", "both"],
    ["skills/personal/SKILL.md", "claude"],
  ] as const)(
    "uninstall rejects correctly hashed but unmanaged sentinel path %s for target %s",
    async (relativePath, target) => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-unmanaged-sentinel-path-"));
      const claudeDir = join(home, ".claude");
      try {
        expect((await runInstall(home)).exitCode).toBe(0);
        const sentinelPath = join(claudeDir, ".cc-settings-version");
        const personalPath = join(claudeDir, relativePath);
        const personalBytes = `personal bytes for ${relativePath}\n`;
        await mkdir(resolve(personalPath, ".."), { recursive: true });
        await writeFile(personalPath, personalBytes);
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_files: Record<string, string>;
        };
        sentinel.managed_files[relativePath] = new Bun.CryptoHasher("sha256")
          .update(personalBytes)
          .digest("hex");
        const sentinelBytes = `${JSON.stringify(sentinel, null, 2)}\n`;
        await writeFile(sentinelPath, sentinelBytes);
        const managedAgent = join(claudeDir, "agents", "implementer.md");
        const managedAgentBytes = await readFile(managedAgent, "utf8");

        const result = await runInstall(home, ["--uninstall"], target);
        expect(result.exitCode).not.toBe(0);
        expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
        expect(await readFile(personalPath, "utf8")).toBe(personalBytes);
        expect(await readFile(managedAgent, "utf8")).toBe(managedAgentBytes);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each(["full", "light"] as const)(
    "%s sentinel rejects every incomplete managed_files map and accepts the exact map",
    async (profile) => {
      const home = await mkdtemp(join(tmpdir(), `cc-e2e-managed-map-${profile}-`));
      const claudeDir = join(home, ".claude");
      try {
        expect((await runInstall(home, profile === "light" ? ["--light"] : [])).exitCode).toBe(0);
        const sentinelPath = join(claudeDir, ".cc-settings-version");
        const original = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_files: Record<string, string>;
        };
        const paths = Object.keys(original.managed_files);
        expect(paths).toEqual(
          expect.arrayContaining([
            ".cc-settings-hooks-fingerprint",
            ".cc-settings-src-manifest",
            "src/setup.ts",
          ]),
        );
        if (profile === "full") expect(paths).toContain(".cc-settings-baseline.json");
        const representative = paths.find((path) => existsSync(join(claudeDir, path)));
        expect(representative).toBeDefined();
        const managedPath = join(claudeDir, representative as string);
        const managedBytes = await readFile(managedPath, "utf8");
        for (const missing of [null, ...paths]) {
          const managed_files =
            missing === null
              ? {}
              : Object.fromEntries(
                  Object.entries(original.managed_files).filter(([path]) => path !== missing),
                );
          const mutatedBytes = `${JSON.stringify({ ...original, managed_files }, null, 2)}\n`;
          await writeFile(sentinelPath, mutatedBytes);
          const uninstall = await runInstall(home, ["--uninstall"]);
          expect(uninstall.exitCode, `missing ${missing ?? "all"}`).not.toBe(0);
          expect(await readFile(sentinelPath, "utf8")).toBe(mutatedBytes);
          expect(await readFile(managedPath, "utf8")).toBe(managedBytes);
        }
        await writeFile(sentinelPath, `${JSON.stringify(original, null, 2)}\n`);
        expect((await runInstall(home, ["--uninstall"])).exitCode).toBe(0);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test("legacy absent managed_files fails closed before uninstall mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-null-managed-map-"));
    try {
      expect((await runInstall(home)).exitCode).toBe(0);
      const sentinelPath = join(home, ".claude", ".cc-settings-version");
      const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as Record<string, unknown>;
      delete sentinel.managed_files;
      const sentinelBytes = `${JSON.stringify(sentinel, null, 2)}\n`;
      await writeFile(sentinelPath, sentinelBytes);
      const managedPath = join(home, ".claude", "agents", "implementer.md");
      const managedBytes = await readFile(managedPath, "utf8");
      const uninstall = await runInstall(home, ["--uninstall"]);
      expect(uninstall.exitCode).not.toBe(0);
      expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
      expect(await readFile(managedPath, "utf8")).toBe(managedBytes);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test("an older Claude managed-file subset upgrades only when the newly managed path is absent", async () => {
    const absentHome = await mkdtemp(join(tmpdir(), "cc-e2e-claude-upgrade-absent-"));
    const liveHome = await mkdtemp(join(tmpdir(), "cc-e2e-claude-upgrade-live-"));
    try {
      for (const [home, removeLivePath, target] of [
        [absentHome, true, "claude"],
        [liveHome, false, "both"],
      ] as const) {
        expect((await runInstall(home, [], target)).exitCode).toBe(0);
        const claudeDir = join(home, ".claude");
        const sentinelPath = join(claudeDir, ".cc-settings-version");
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_files: Record<string, string>;
        };
        const previousPaths = await claudeManagedAllowedPaths(REPO, "full", 1);
        const newlyManaged = Object.keys(sentinel.managed_files).filter(
          (path) => !previousPaths.has(path),
        );
        expect(newlyManaged.sort()).toEqual(
          [
            "docs/README.md",
            "docs/claude-vs-codex.md",
            "docs/first-session.md",
            "docs/skills.md",
            "docs/system-overview.md",
            "docs/troubleshooting.md",
            "src/lib/claude-managed-file-manifests.ts",
            "src/lib/claude-managed-files.ts",
            "src/scripts/migrate-legacy-codex-skills.ts",
          ].sort(),
        );
        for (const path of newlyManaged) delete sentinel.managed_files[path];
        (sentinel as Record<string, unknown>).managed_files_manifest_version = 1;
        const sentinelBytes = `${JSON.stringify(sentinel, null, 2)}\n`;
        await writeFile(sentinelPath, sentinelBytes);
        const omittedPaths = newlyManaged.map((path) => join(claudeDir, path));
        const originalBytes = await Promise.all(omittedPaths.map((path) => readFile(path, "utf8")));
        if (removeLivePath) {
          await Promise.all(omittedPaths.map((path) => rm(path)));
        }
        const codexPaths =
          target === "both"
            ? [
                join(home, ".codex", ".cc-settings-version"),
                join(home, ".codex", "AGENTS.md"),
                join(home, ".codex", "agents", "implementer.toml"),
                join(home, ".codex", "rules", "darkroom.rules"),
              ]
            : [];
        const codexBefore = new Map(
          await Promise.all(codexPaths.map(async (path) => [path, await readFile(path)] as const)),
        );

        const upgrade = await runInstall(home, [], target);
        if (removeLivePath) {
          expect(upgrade.exitCode, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);
          const upgraded = JSON.parse(await readFile(sentinelPath, "utf8")) as {
            managed_files: Record<string, string>;
          };
          for (const [index, path] of newlyManaged.entries()) {
            expect(upgraded.managed_files[path]).toMatch(/^[a-f0-9]{64}$/);
            expect(await readFile(omittedPaths[index] as string, "utf8")).toBe(
              originalBytes[index] as string,
            );
          }
        } else {
          expect(upgrade.exitCode).not.toBe(0);
          expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
          for (const [index, path] of omittedPaths.entries()) {
            expect(await readFile(path, "utf8")).toBe(originalBytes[index] as string);
          }
          for (const [path, bytes] of codexBefore) {
            expect(await readFile(path), path).toEqual(bytes);
          }
        }
      }
    } finally {
      await Promise.all([
        rm(absentHome, { recursive: true, force: true }),
        rm(liveHome, { recursive: true, force: true }),
      ]);
    }
  }, 240_000);

  test("unsafe managed_files paths abort uninstall without touching managed state", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-uninstall-unsafe-"));
    const claudeDir = join(home, ".claude");
    try {
      const install = await runInstall(home);
      expect(install.exitCode).toBe(0);
      const sentinelPath = join(claudeDir, ".cc-settings-version");
      const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
        managed_files: Record<string, string>;
      };
      sentinel.managed_files["../escape"] = "0".repeat(64);
      const sentinelBytes = `${JSON.stringify(sentinel, null, 2)}\n`;
      await writeFile(sentinelPath, sentinelBytes);
      const managedPath = join(claudeDir, "agents", "reviewer.md");
      const managedBytes = await readFile(managedPath, "utf8");

      const uninstall = await runInstall(home, ["--uninstall"]);
      expect(uninstall.exitCode).not.toBe(0);
      expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
      expect(await readFile(managedPath, "utf8")).toBe(managedBytes);
      expect(existsSync(join(home, "escape"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("both-target light rollback restores full Claude ownership before clean uninstall", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-e2e-both-rollback-uninstall-"));
    const claudeDir = join(home, ".claude");
    const personalPath = join(claudeDir, "agents", "personal.md");
    const userSettings = { personalSetting: "keep" };
    const userClaudeJson = {
      mcpServers: { personal: { command: "personal-mcp", args: ["--keep"] } },
    };
    try {
      await mkdir(join(claudeDir, "agents"), { recursive: true });
      await Promise.all([
        writeFile(join(claudeDir, "settings.json"), `${JSON.stringify(userSettings)}\n`),
        writeFile(join(home, ".claude.json"), `${JSON.stringify(userClaudeJson)}\n`),
      ]);

      const full = await runInstall(home, [], "both");
      expect(full.exitCode).toBe(0);
      expect(existsSync(join(claudeDir, ".cc-settings-baseline.json"))).toBe(true);
      await writeFile(personalPath, "personal exact bytes\n");
      expect(
        (await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).length,
      ).toBeGreaterThan(0);

      const light = await runInstall(home, ["--light"], "both");
      expect(light.exitCode).toBe(0);
      expect(
        JSON.parse(await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).profile,
      ).toBe("light");
      const lightSentinel = JSON.parse(
        await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
      ) as { managed_files: Record<string, string> };
      expect(lightSentinel.managed_files[".cc-settings-baseline.json"]).toBeUndefined();
      expect(existsSync(join(claudeDir, ".cc-settings-baseline.json"))).toBe(false);

      const rollback = await runInstall(home, ["--rollback"], "both");
      if (rollback.exitCode !== 0) {
        throw new Error(
          `both-target rollback failed (${rollback.exitCode})\nstdout:\n${rollback.stdout}\nstderr:\n${rollback.stderr}`,
        );
      }
      const restored = JSON.parse(
        await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
      ) as {
        profile?: unknown;
        mcp_written?: unknown;
        managed_files?: unknown;
      };
      expect(restored.profile).toBe("full");
      expect(typeof restored.mcp_written).toBe("object");
      expect(Array.isArray(restored.mcp_written)).toBe(false);
      expect(Object.keys(restored.mcp_written as Record<string, unknown>).length).toBeGreaterThan(
        0,
      );
      expect(typeof restored.managed_files).toBe("object");
      expect(Array.isArray(restored.managed_files)).toBe(false);
      expect(Object.keys(restored.managed_files as Record<string, unknown>).length).toBeGreaterThan(
        0,
      );
      expect(
        (restored.managed_files as Record<string, unknown>)[".cc-settings-baseline.json"],
      ).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(claudeDir, ".cc-settings-baseline.json"))).toBe(true);
      for (const path of [
        "skills/fix/SKILL.md",
        "src/setup.ts",
        ".cc-settings-hooks-fingerprint",
        ".cc-settings-src-manifest",
        ".cc-settings-baseline.json",
      ]) {
        expect(existsSync(join(claudeDir, path)), `${path} must be restored`).toBe(true);
      }

      const backupsDir = join(claudeDir, "backups");
      const backupsBeforeUninstall = (await readdir(backupsDir)).filter((name) =>
        name.endsWith(".tar.gz"),
      );
      const uninstall = await runInstall(home, ["--uninstall"], "both");
      expect(uninstall.exitCode).toBe(0);
      for (const path of [
        ".cc-settings-version",
        "skills/fix",
        "src",
        ".cc-settings-hooks-fingerprint",
        ".cc-settings-src-manifest",
      ]) {
        expect(existsSync(join(claudeDir, path)), `${path} must be removed`).toBe(false);
      }
      expect(await readFile(personalPath, "utf8")).toBe("personal exact bytes\n");
      expect(JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"))).toEqual(
        userSettings,
      );
      expect(JSON.parse(await readFile(join(home, ".claude.json"), "utf8"))).toEqual(
        userClaudeJson,
      );
      const backupsAfterUninstall = (await readdir(backupsDir)).filter((name) =>
        name.endsWith(".tar.gz"),
      );
      expect(backupsAfterUninstall.length).toBe(backupsBeforeUninstall.length + 1);
      for (const backup of backupsBeforeUninstall) expect(backupsAfterUninstall).toContain(backup);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// Light install E2E
// ---------------------------------------------------------------------------

describe("install E2E — light profile", () => {
  test(
    "--light fresh install: only share-learning skill, no CLAUDE.md/AGENTS.md, settings=$schema+statusLine only",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-light-"));
      try {
        const result = await runInstall(home, ["--light"]);
        if (result.exitCode !== 0) {
          throw new Error(
            `light installer failed (${result.exitCode})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // Skills: ONLY share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = new Set(await readdir(skillsDir).catch(() => []));
        for (const skill of LIGHT_SKILLS) {
          expect(installedSkills.has(skill), `skill "${skill}" should be installed`).toBe(true);
        }
        for (const installed of installedSkills) {
          expect(
            (LIGHT_SKILLS as readonly string[]).includes(installed),
            `"${installed}" should NOT be in a light install`,
          ).toBe(true);
        }

        // No agents dir (or empty).
        const agentsDir = join(claudeDir, "agents");
        if (existsSync(agentsDir)) {
          const agentFiles = (await readdir(agentsDir).catch(() => [])).filter((f) =>
            f.endsWith(".md"),
          );
          expect(agentFiles.length).toBe(0);
        }

        // No CLAUDE.md.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        // No AGENTS.md.
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(false);
        for (const dir of ["rules", "contexts", "profiles"]) {
          const entries = await readdir(join(claudeDir, dir)).catch(() => []);
          expect(entries, `${dir}/ must contain no managed light-profile files`).toHaveLength(0);
        }
        // No docs/ (or empty).
        if (existsSync(join(claudeDir, "docs"))) {
          const docFiles = (await readdir(join(claudeDir, "docs")).catch(() => [])).filter((f) =>
            f.endsWith(".md"),
          );
          expect(docFiles.length).toBe(0);
        }

        // settings.json: only $schema + statusLine — no mcpServers, no hooks, no env,
        // no permissions.
        const settingsRaw = await readFile(join(claudeDir, "settings.json"), "utf8");
        const settings = JSON.parse(settingsRaw) as Record<string, unknown>;
        expect(settings.$schema).toBeTruthy();
        expect(settings.statusLine).toBeTruthy();
        expect(
          "mcpServers" in settings && Object.keys(settings.mcpServers as object).length > 0,
        ).toBe(false);
        expect("hooks" in settings && Object.keys(settings.hooks as object).length > 0).toBe(false);
        expect(
          "env" in settings &&
            (settings.env as Record<string, unknown>).CLAUDE_CODE_EFFORT_LEVEL !== undefined,
        ).toBe(false);
        expect(
          "permissions" in settings &&
            ((settings.permissions as Record<string, unknown[]>).allow?.length ?? 0) > 0,
        ).toBe(false);

        // src/ is present (statusLine command references it).
        expect(existsSync(join(claudeDir, "src"))).toBe(true);

        // Sentinel profile === "light".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string; managed_files?: Record<string, string> };
        expect(sentinel.profile).toBe("light");
        expect(sentinel.managed_files?.[".cc-settings-baseline.json"]).toBeUndefined();
        expect(existsSync(join(claudeDir, ".cc-settings-baseline.json"))).toBe(false);

        const uninstall = await runInstall(home, ["--uninstall"]);
        expect(uninstall.exitCode).toBe(0);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(claudeDir, "src"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "full → light switch: cc-settings footprint gone, only share-learning remains",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-switch-fl-"));
      try {
        // First: full install.
        const full = await runInstall(home, []);
        expect(full.exitCode).toBe(0);

        // Verify full install has CLAUDE.md before the switch.
        expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(true);

        // Second: switch to light.
        const light = await runInstall(home, ["--light"]);
        if (light.exitCode !== 0) {
          throw new Error(
            `light switch failed (${light.exitCode})\nstdout:\n${light.stdout}\nstderr:\n${light.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // skills: only share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = new Set(await readdir(skillsDir).catch(() => []));
        for (const skill of LIGHT_SKILLS) {
          expect(installedSkills.has(skill), `skill "${skill}" should be present`).toBe(true);
        }
        for (const installed of installedSkills) {
          expect(
            (LIGHT_SKILLS as readonly string[]).includes(installed),
            `"${installed}" should NOT be present after full→light switch`,
          ).toBe(true);
        }

        // No CLAUDE.md / AGENTS.md after switch.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(false);
        // No agents dir files.
        if (existsSync(join(claudeDir, "agents"))) {
          const agentFiles = (await readdir(join(claudeDir, "agents")).catch(() => [])).filter(
            (f) => f.endsWith(".md"),
          );
          expect(agentFiles.length).toBe(0);
        }
        for (const dir of ["rules", "contexts", "profiles", "docs"]) {
          const entries = await readdir(join(claudeDir, dir)).catch(() => []);
          expect(entries, `${dir}/ must contain no managed full-profile files`).toHaveLength(0);
        }

        // settings.json: no cc-settings env, no cc-settings permissions, no cc-settings hooks.
        const settings = JSON.parse(
          await readFile(join(claudeDir, "settings.json"), "utf8"),
        ) as Record<string, unknown>;
        // No CLAUDE_CODE_EFFORT_LEVEL.
        const env = (settings.env ?? {}) as Record<string, unknown>;
        expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
        // No mcpServers with cc-settings content.
        const mcp = (settings.mcpServers ?? {}) as Record<string, unknown>;
        expect("context7" in mcp).toBe(false);
        // No cc-settings hooks.
        const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
        const allHookCommands = Object.values(hooks)
          .flat()
          .flatMap((g: unknown) => {
            const gr = g as { hooks?: Array<{ command?: string }> };
            return (gr.hooks ?? []).map((h) => h.command ?? "");
          });
        expect(
          allHookCommands.some(
            (c) => c.includes("/.claude/src/hooks/") || c.includes("/.claude/src/scripts/"),
          ),
        ).toBe(false);

        // No cc-settings scalar/object settings leaked from the full install
        // (sandbox, teammateMode, spinnerVerbs, attribution, …). A clean full→light
        // switch with no user-authored settings must reduce to exactly $schema + statusLine.
        expect(Object.keys(settings).sort()).toEqual(["$schema", "statusLine"]);

        // Sentinel profile === "light".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string; managed_files?: Record<string, string> };
        expect(sentinel.profile).toBe("light");
        expect(sentinel.managed_files?.[".cc-settings-baseline.json"]).toBeUndefined();
        expect(existsSync(join(claudeDir, ".cc-settings-baseline.json"))).toBe(false);

        const uninstall = await runInstall(home, ["--uninstall"]);
        expect(uninstall.exitCode).toBe(0);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(claudeDir, "src"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );

  test(
    "light → full switch: CLAUDE.md present, agents present, all skills present, sentinel=full",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-switch-lf-"));
      try {
        // First: light install.
        const light = await runInstall(home, ["--light"]);
        expect(light.exitCode).toBe(0);

        // Second: switch to full.
        const full = await runInstall(home, []);
        if (full.exitCode !== 0) {
          throw new Error(
            `full switch failed (${full.exitCode})\nstdout:\n${full.stdout}\nstderr:\n${full.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // CLAUDE.md and AGENTS.md restored.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(true);

        // agents/ has content.
        const agentsDir = join(claudeDir, "agents");
        expect(existsSync(agentsDir)).toBe(true);
        const agentFiles = (await readdir(agentsDir).catch(() => [])).filter((f) =>
          f.endsWith(".md"),
        );
        expect(agentFiles.length).toBeGreaterThan(0);

        // skills has more than just share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = await readdir(skillsDir).catch(() => []);
        expect(installedSkills.length).toBeGreaterThan(1);

        // settings.json has statusLine (full inherits it).
        const settings = JSON.parse(
          await readFile(join(claudeDir, "settings.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(settings.statusLine).toBeTruthy();

        // Sentinel profile === "full".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string };
        expect(sentinel.profile).toBe("full");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );
});

// ---------------------------------------------------------------------------
// Auto-update enrollment E2E (macOS only — the sentinel field is only ever
// written when os === "macos"; see applyAutoUpdate in src/setup.ts)
// ---------------------------------------------------------------------------

describe("install E2E — auto-update enrollment", () => {
  test.skipIf(process.platform !== "darwin")(
    "--auto-update=on writes sentinel auto_update:true and registers the launchd plist",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-autoupdate-"));
      try {
        const result = await runInstall(home, ["--auto-update=on"]);
        if (result.exitCode !== 0) {
          throw new Error(
            `installer exited with ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        const sentinel = JSON.parse(
          await readFile(join(home, ".claude", ".cc-settings-version"), "utf8"),
        ) as { auto_update?: boolean };
        expect(sentinel.auto_update).toBe(true);

        const plistPath = join(
          home,
          "Library",
          "LaunchAgents",
          "com.darkroom.cc-settings-autoupdate.plist",
        );
        expect(existsSync(plistPath)).toBe(true);
        const plistContent = await readFile(plistPath, "utf8");
        expect(plistContent).toContain("<integer>10</integer>");
        expect(plistContent).toContain("com.darkroom.cc-settings-autoupdate");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test.skipIf(process.platform !== "darwin")(
    "a second run without the flag preserves the prior enrollment decision",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-autoupdate2-"));
      try {
        const first = await runInstall(home, ["--auto-update=on"]);
        expect(first.exitCode).toBe(0);

        const second = await runInstall(home, []);
        expect(second.exitCode).toBe(0);

        const sentinel = JSON.parse(
          await readFile(join(home, ".claude", ".cc-settings-version"), "utf8"),
        ) as { auto_update?: boolean };
        expect(sentinel.auto_update).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 90_000 },
  );
});
