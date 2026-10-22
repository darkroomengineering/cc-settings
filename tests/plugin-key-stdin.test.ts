// The TypeSafe key must reach the fast-jev plugin on stdin, never in process
// arguments (other users can read those through `ps` or /proc/<pid>/cmdline).
// A fake `claude` on PATH logs every argv and stdin; the plugin step runs in a
// subprocess so HOME and PATH are set before CLAUDE_DIR is computed.

import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const REPO = resolve(import.meta.dir, "..");
const KEY = "ts-test-key-4f1c";

async function runPluginStep(configureExit: number): Promise<{ argv: string; stdin: string }> {
  const root = await mkdtemp(join(tmpdir(), "cc-plugin-key-"));
  try {
    const bin = join(root, "bin");
    const home = join(root, "home");
    await mkdir(bin, { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    const log = join(root, "argv.log");
    const stdinLog = join(root, "stdin.log");
    await writeFile(
      join(bin, "claude"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "${gitBashPath(log)}"
case "$1 $2" in
  "plugin list"|"plugin marketplace") [ "$3" = "list" ] || [ "$2" = "list" ] && { echo '[]'; exit 0; } ;;
esac
if [ "$1 $2" = "plugin configure" ]; then cat >> "${gitBashPath(stdinLog)}"; exit ${configureExit}; fi
exit 0
`,
    );
    await chmod(join(bin, "claude"), 0o755);
    const script = `import { installPlugins } from ${JSON.stringify(join(REPO, "src/lib/claude-install-settings.ts"))};
await installPlugins("full", false, { typesafeKey: ${JSON.stringify(KEY)} });`;
    const proc = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        PATH: prependTestPath(bin),
        HOME: home,
        USERPROFILE: home,
        CLAUDECODE: undefined,
        TYPESAFE_API_KEY: undefined,
        CC_SETTINGS_FORCE_PLUGIN_INSTALL: "1",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (exit !== 0) throw new Error(`plugin step exited ${exit}: ${stderr}`);
    return {
      argv: await readFile(log, "utf8"),
      stdin: await readFile(stdinLog, "utf8").catch(() => ""),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("TypeSafe key delivery to the plugin", () => {
  test("goes on stdin through plugin configure, never in argv", async () => {
    const { argv, stdin } = await runPluginStep(0);
    expect(argv).toContain(
      "plugin configure fast-jev-compaction@fast-jev-compaction --values-stdin",
    );
    expect(argv).not.toContain(KEY);
    expect(JSON.parse(stdin)).toEqual({ apiKey: KEY });
  }, 60_000);

  test("falls back to the install argument when configure is unavailable", async () => {
    const { argv } = await runPluginStep(1);
    expect(argv).toContain(
      `plugin install fast-jev-compaction@fast-jev-compaction --config apiKey=${KEY}`,
    );
  }, 60_000);
});
