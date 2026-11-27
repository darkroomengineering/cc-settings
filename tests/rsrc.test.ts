// rsrc.ts: detection and the setup install offer, run in a child bun under a
// throwaway HOME. Without uv, PATH is an empty directory, so a real uv can never
// run the network install. "With uv" cases put a logging shim first on PATH, ahead
// of the system directories its shell commands need; the shim creates the rsrc
// binary uv would install.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { findRsrc, RSRC_COMMIT, RSRC_INSTALL } from "../src/lib/rsrc.ts";

const REPO = resolve(import.meta.dir, "..");
const posix = process.platform !== "win32";
// Each case spawns a bun child; the 5 s default is too tight under a loaded suite.
setDefaultTimeout(30_000);

const INSTALL_LINE = `uv tool install git+https://github.com/SamuelZ12/research-sources@${RSRC_COMMIT}`;

let tmp: string;
let home: string;
let shimDir: string;
let shimLog: string;
let emptyDir: string;

async function writeExe(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

/** Runs `call` in a child bun with rsrc.ts imported; returns stdout + stderr. */
async function offer(
  call: string,
  opts: { withUv?: boolean; env?: Record<string, string> } = {},
): Promise<string> {
  const script = join(tmp, "run-offer.ts");
  await writeFile(
    script,
    `import { askRsrcUpfront, installRsrc } from ${JSON.stringify(join(REPO, "src/lib/rsrc.ts"))};
${call}
`,
  );
  const proc = Bun.spawn([process.execPath, script], {
    env: {
      HOME: home,
      PATH: opts.withUv ? [shimDir, "/usr/bin", "/bin"].join(delimiter) : emptyDir,
      NO_COLOR: "1",
      ...opts.env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(exit, err).toBe(0);
  return out + err;
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rsrc-test-"));
  home = join(tmp, "home");
  shimDir = join(tmp, "shim");
  shimLog = join(tmp, "uv.log");
  emptyDir = join(tmp, "empty");
  await mkdir(home, { recursive: true });
  await mkdir(emptyDir);
  // Logs its argv and creates rsrc where `uv tool install` puts it.
  await writeExe(
    join(shimDir, "uv"),
    `echo "$@" >> '${shimLog}'
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\\n' > "$HOME/.local/bin/rsrc"
chmod 755 "$HOME/.local/bin/rsrc"`,
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("rsrc detection", () => {
  test.skipIf(!posix)("finds rsrc on PATH, in ~/.local/bin, or in $UV_TOOL_BIN_DIR", async () => {
    const prior = process.env.UV_TOOL_BIN_DIR;
    delete process.env.UV_TOOL_BIN_DIR;
    try {
      expect(findRsrc("", home)).toBeNull();
    } finally {
      if (prior !== undefined) process.env.UV_TOOL_BIN_DIR = prior;
    }

    const onPath = join(tmp, "path-bin", "rsrc");
    await writeExe(onPath, "");
    expect(findRsrc(dirname(onPath), home)).toBe(onPath);

    const local = join(home, ".local", "bin", "rsrc");
    await writeExe(local, "");
    expect(findRsrc("", home)).toBe(local);

    const custom = join(tmp, "uv-tools", "rsrc");
    await writeExe(custom, "");
    process.env.UV_TOOL_BIN_DIR = dirname(custom);
    try {
      expect(findRsrc("", home)).toBe(custom);
    } finally {
      if (prior === undefined) delete process.env.UV_TOOL_BIN_DIR;
      else process.env.UV_TOOL_BIN_DIR = prior;
    }
  });

  test("the install argv pins the reviewed commit", () => {
    expect(RSRC_INSTALL.join(" ")).toBe(INSTALL_LINE);
    expect(RSRC_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  test("every commit the skill and install docs name is RSRC_COMMIT", async () => {
    const skillDir = join(REPO, "skills", "research-sources");
    const files = [
      join(skillDir, "SKILL.md"),
      ...(await readdir(join(skillDir, "references"))).map((f) => join(skillDir, "references", f)),
      join(REPO, "docs", "install.md"),
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const sha of text.match(/\b[0-9a-f]{40}\b/g) ?? []) expect(sha, file).toBe(RSRC_COMMIT);
    }
    for (const file of [join(skillDir, "SKILL.md"), join(REPO, "docs", "install.md")]) {
      expect(await readFile(file, "utf8"), file).toContain(INSTALL_LINE);
    }
    // No install source without the pin, such as upstream's unpinned line.
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const source of text.match(
        /git\+https:\/\/github\.com\/SamuelZ12\/research-sources\S*/g,
      ) ?? []) {
        expect(source, file).toStartWith(
          `git+https://github.com/SamuelZ12/research-sources@${RSRC_COMMIT}`,
        );
      }
    }
  });
});

describe.skipIf(!posix)("the rsrc install offer", () => {
  const declined = () => join(home, ".claude", ".rsrc-declined");

  test("asks nothing when not interactive, even with uv present", async () => {
    expect(
      await offer('console.log(String(await askRsrcUpfront("full", false)));', { withUv: true }),
    ).toBe("undefined\n");
  });

  test("prints the pinned install line when it cannot install", async () => {
    const hint = `Optional: \`${INSTALL_LINE}\``;
    expect(await offer('await installRsrc("full", undefined, false);')).toContain(hint);
    // A yes without uv on the machine falls back to the hint.
    expect(await offer('await installRsrc("full", true, false);')).toContain(hint);
  });

  test("silent on the light profile, CC_RSRC=0 and CC_SKIP_DEPS=1", async () => {
    expect(await offer('await installRsrc("light", undefined, false);')).toBe("");
    expect(await offer('console.log(String(await askRsrcUpfront("light", false)));')).toBe(
      "undefined\n",
    );
    expect(
      await offer('await installRsrc("full", undefined, false);', { env: { CC_RSRC: "0" } }),
    ).toBe("");
    expect(
      await offer('await installRsrc("full", undefined, false);', { env: { CC_SKIP_DEPS: "1" } }),
    ).toBe("");
    expect(
      await offer('await installRsrc("full", true, false);', {
        withUv: true,
        env: { CC_RSRC: "0" },
      }),
    ).toBe("");
    expect(existsSync(shimLog)).toBe(false);
  });

  test("a no is remembered, and a fresh install ignores it", async () => {
    expect(await offer('await installRsrc("full", false, false);')).toContain("won't ask again");
    expect(existsSync(declined())).toBe(true);
    expect(await offer('await installRsrc("full", undefined, false);')).toBe("");
    expect(await offer('await installRsrc("full", undefined, true);')).toContain(
      `Optional: \`${INSTALL_LINE}\``,
    );
  });

  test("a Codex-only no lands in the given state dir, not ~/.claude", async () => {
    const codexHome = join(home, ".codex");
    const call = (answer: string) =>
      `await installRsrc("full", ${answer}, false, ${JSON.stringify(codexHome)});`;
    expect(await offer(call("false"))).toContain(join(codexHome, ".rsrc-declined"));
    expect(existsSync(join(codexHome, ".rsrc-declined"))).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(await offer(call("undefined"))).toBe("");
  });

  test("a no that cannot be saved says setup will ask again", async () => {
    // A file where ~/.claude should be makes the marker write fail.
    await writeFile(join(home, ".claude"), "");
    const out = await offer('await installRsrc("full", false, false);');
    expect(out).toContain("couldn't save that answer");
    expect(out).not.toContain("won't ask again");
  });

  test("a yes runs the pinned uv install", async () => {
    const out = await offer('await installRsrc("full", true, false);', { withUv: true });
    expect(out).toContain(`rsrc installed at ${RSRC_COMMIT.slice(0, 7)}`);
    expect(await readFile(shimLog, "utf8")).toBe(`${RSRC_INSTALL.slice(1).join(" ")}\n`);
  });

  test("leaves an installed rsrc alone", async () => {
    await writeExe(join(home, ".local", "bin", "rsrc"), "");
    expect(await offer('await installRsrc("full", true, false);', { withUv: true })).toBe("");
    expect(await offer('await installRsrc("full", undefined, false);')).toBe("");
    expect(existsSync(shimLog)).toBe(false);
  });
});
