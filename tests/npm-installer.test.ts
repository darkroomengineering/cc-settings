// Tests for npm-installer/bin/cc-settings.js — the `npx cc-settings` stub.
// The stub downloads the bootstrap and runs it as a lone script file; these
// tests serve the REAL setup.sh from a local HTTP server and redirect the
// bootstrap's clone to a local fixture, so the whole chain runs offline.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prependTestPath } from "./support/portable-process.ts";

const REPO = resolve(import.meta.dir, "..");
const STUB = join(REPO, "npm-installer", "bin", "cc-settings.js");
const OFFICIAL_URL = "https://github.com/darkroomengineering/cc-settings.git";

describe.skipIf(process.platform === "win32")("npm installer stub", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(async () => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/setup.sh") return new Response(Bun.file(join(REPO, "setup.sh")));
        if (path === "/missing/setup.sh") return new Response("nope", { status: 404 });
        return new Response("not found", { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  async function makeHarness(root: string): Promise<Record<string, string>> {
    const fixture = join(root, "fixture");
    const bin = join(root, "bin");
    const home = join(root, "home");
    await Promise.all([
      mkdir(fixture, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(home, { recursive: true }),
    ]);
    await writeFile(join(fixture, "setup.sh"), '#!/bin/sh\necho "STUB-ARGS:[$*]"\n', {
      mode: 0o755,
    });
    // Bootstrap clone-completeness check requires the files a real clone has.
    await mkdir(join(fixture, "src"), { recursive: true });
    await Promise.all([
      writeFile(join(fixture, "src", "setup.ts"), ""),
      writeFile(join(fixture, "package.json"), "{}\n"),
    ]);
    const fixtureGit = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
        cwd: fixture,
        stdout: "pipe",
        stderr: "pipe",
      });
    for (const args of [
      ["-c", "init.defaultBranch=main", "init", "."],
      ["add", "-A"],
      ["commit", "-qm", "init"],
    ]) {
      const result = fixtureGit(...args);
      if (result.exitCode !== 0) throw new Error(`fixture git ${args[0]}: ${result.stderr}`);
    }
    const realGit = Bun.which("git");
    if (!realGit) throw new Error("git not on PATH");
    await writeFile(
      join(bin, "git"),
      `#!/bin/bash
URL="${OFFICIAL_URL}"
is_clone=0; dest=""
args=(); for a in "$@"; do
  [[ "$a" == "clone" ]] && is_clone=1
  [[ "$a" == "$URL" ]] && a="${fixture}"
  args+=("$a"); dest="$a"
done
"${realGit}" "\${args[@]}"; rc=$?
if [[ $rc -eq 0 && $is_clone -eq 1 && -d "$dest/.git" ]]; then
  "${realGit}" -C "$dest" remote set-url origin "$URL"
fi
exit $rc
`,
      { mode: 0o755 },
    );
    await chmod(join(bin, "git"), 0o755);
    return {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: prependTestPath(bin),
      CC_SETTINGS_INSTALL_BASE: base,
    } as Record<string, string>;
  }

  // Async spawn on purpose: Bun.spawnSync blocks the event loop, and the
  // HTTP server the stub downloads from lives in THIS process — a sync wait
  // deadlocks (the server can never answer while we block on the child).
  async function runStub(env: Record<string, string>, args: string[]) {
    const node = Bun.which("node") ?? process.execPath;
    const proc = Bun.spawn([node, STUB, ...args], { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  test("downloads the bootstrap, bootstraps a managed clone, and forwards flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-npx-"));
    try {
      const env = await makeHarness(root);
      const result = await runStub(env, ["--light", "--auto-update=on"]);
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("STUB-ARGS:[--light --auto-update=on]");
      expect(
        existsSync(join(root, "home", ".local", "share", "cc-settings", "source", ".git")),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  test("a failed download exits non-zero with the git-clone fallback named", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-npx-404-"));
    try {
      const env = await makeHarness(root);
      env.CC_SETTINGS_INSTALL_BASE = `${base}/missing`;
      const result = await runStub(env, []);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("could not download");
      expect(result.stderr).toContain("git clone");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("the installer's exit code propagates", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-npx-exit-"));
    try {
      const env = await makeHarness(root);
      // Unknown flags fail closed inside setup.ts; here the fixture stub
      // always exits 0, so force a failure earlier: break git so the
      // bootstrap's clone fails.
      await writeFile(join(root, "bin", "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      const result = await runStub(env, []);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("git clone failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
