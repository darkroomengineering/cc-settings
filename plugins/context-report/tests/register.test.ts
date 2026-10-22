// Runs under `claude plugin test plugins/context-report`: `$` is the engine's
// own, and the hooks `on` registers here sit beneath the plugin, answering the
// nouns it calls from memory.
import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

const HOME = "/home/me";
const CWD = "/home/me/repo";

/** Answers the nouns the plugin calls from memory; `files` are the paths
 *  `$.fs.stat` finds, everything else leads nowhere. */
function seat(on: On, files: readonly string[]) {
  const logged: { text: string; to: string }[] = [];
  on("ui.log", (_$, e) => {
    logged.push({ text: e.text, to: e.to });
    return { value: undefined };
  });
  on("session.cwd", () => ({ value: CWD }));
  mock.env(on, { HOME });
  on("fs.stat", (_$, e) => {
    if (files.includes(e.path)) return { value: { kind: "file" as const, size: 1, mtimeMs: 0, isLink: false } };
    throw new Error(`ENOENT: ${e.path}`);
  });
  return logged;
}

describe("register", () => {
  test("reports the user CLAUDE.md with its @AGENTS.md import and the project's AGENTS.md", async ($, on) => {
    const logged = seat(on, [`${CWD}/AGENTS.md`]);
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
    await $.prompt.context({
      blocks: [{ name: "claudeMd", text: "..." }],
      instructionFiles: [
        { path: `${HOME}/.claude/CLAUDE.md`, kind: "user", content: "@AGENTS.md\nrules" },
        { path: `${HOME}/.claude/AGENTS.md`, kind: "user", content: "standards", parent: `${HOME}/.claude/CLAUDE.md` },
        { path: `${CWD}/AGENTS.md`, kind: "project", content: "project notes" },
      ],
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.to).toBe("transcript");
    expect(logged[0]?.text).toContain("user ~/.claude/CLAUDE.md +@AGENTS.md");
    expect(logged[0]?.text).toContain("project ./AGENTS.md");
  });

  test("hints at /cc migrate when a project CLAUDE.md loaded, and logs to debug when not interactive", async ($, on) => {
    const logged = seat(on, []);
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false });
    await $.prompt.context({
      blocks: [{ name: "claudeMd", text: "..." }],
      instructionFiles: [{ path: `${CWD}/CLAUDE.md`, kind: "project", content: "notes" }],
    });
    expect(logged).toHaveLength(2);
    expect(logged.every((l) => l.to === "debug")).toBe(true);
    expect(logged[1]?.text).toContain("Run /cc migrate to rename it to AGENTS.md");
  });

  test("says nothing twice for the same load, and nothing when the files are unknown", async ($, on) => {
    const logged = seat(on, []);
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
    const input = {
      blocks: [{ name: "claudeMd", text: "..." }],
      instructionFiles: [{ path: `${CWD}/AGENTS.md`, kind: "project" as const, content: "x" }],
    };
    await $.prompt.context(input);
    await $.prompt.context(input);
    await $.prompt.context({ blocks: [{ name: "claudeMd", text: "rewritten" }] });
    expect(logged).toHaveLength(1);
  });
});
