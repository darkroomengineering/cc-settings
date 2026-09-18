#!/usr/bin/env bun
// Repo-local PreToolUse hook for cc-settings (wired in .claude/settings.json,
// never installed). On `git commit`, run the fast repository-invariant tests
// (prompt byte ceilings, skill/agent/profile lints, manifests, schemas, docs
// sync, version drift) and block the commit when any fails. The full suite
// takes five minutes and runs at PR time; this set runs in a few seconds and
// covers the failures that used to land on main and get found afterwards.
//
// Exit 0 allows. Exit 2 blocks with the reason on stderr. Infrastructure
// errors (bun missing, spawn failure) fail open: this guards invariants, it is
// not itself a gate on the environment.

const INVARIANT_TESTS = [
  "tests/plugin-manifest.test.ts",
  "tests/lint-skills.test.ts",
  "tests/lint-agents.test.ts",
  "tests/lint-profiles.test.ts",
  "tests/schemas.test.ts",
  "tests/docs-permissions.test.ts",
  "tests/docs-settings-keys.test.ts",
  "tests/version-drift.test.ts",
  "tests/agent-schema.test.ts",
  "tests/profile-schema.test.ts",
];

function readCommand(): string {
  const env = process.env.TOOL_INPUT_command;
  if (env) return env;
  try {
    const parsed = JSON.parse(process.env.TOOL_INPUT ?? "{}") as { command?: string };
    return parsed.command ?? "";
  } catch {
    return "";
  }
}

const command = readCommand();
if (!/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  const proc = Bun.spawnSync({
    cmd: ["bun", "test", ...INVARIANT_TESTS],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 100_000,
  });
  if (proc.exitCode === 0) process.exit(0);
  const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
  const failures = out
    .split("\n")
    .filter((line) => line.startsWith("(fail)") || line.startsWith("error:"))
    .slice(0, 12)
    .join("\n");
  console.error(
    `[Harness] Repository invariants failed; commit blocked.\n${failures}\n` +
      `Run: bun test ${INVARIANT_TESTS.join(" ")}`,
  );
  process.exit(2);
} catch {
  process.exit(0);
}
