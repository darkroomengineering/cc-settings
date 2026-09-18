// context-report — a function-hook plugin that says, once per context load,
// exactly which instruction files the engine put behind the `claudeMd` block:
// tier, path, whether AGENTS.md arrived through an `@` import or the native
// read (Claude Code 2.1.277+), and what that costs. The classic SessionStart
// banner inferred this from the filesystem; `prompt.context` hands it over as
// fact, `@` imports included. Two hints ride on the same facts: a project
// whose CLAUDE.md keeps its AGENTS.md from loading, and a user CLAUDE.md that
// lost its @AGENTS.md import. See docs/hooks-reference.md "Function hooks
// (early access)".
//
// Deliberately has NO runtime imports (`import type` erases), so the pure
// functions here run under `bun test` without resolving 'claude-code'.
import type { InstructionFile, On, PluginOptions, PromptContextInput, Register, SessionStartInput } from "claude-code";

export type ReportInput = {
  files: readonly InstructionFile[];
  /** The session's working directory, absolute. */
  cwd: string;
  /** The home directory, for `~/` spellings; undefined shortens nothing. */
  home: string | undefined;
  /** Whether `<cwd>/AGENTS.md` or `<cwd>/.claude/AGENTS.md` exists on disk,
   *  for the migration hint's wording; undefined when unknown. */
  projectAgentsMdExists: boolean | undefined;
};

const PROJECT_CLAUDE_NAMES = new Set(["CLAUDE.md", "CLAUDE.local.md"]);

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** `~/x` under home, `./x` under cwd, else the absolute path. */
export function shortPath(path: string, cwd: string, home: string | undefined): string {
  if (isUnder(path, cwd)) return `./${path.slice(cwd.length).replace(/^\/+/, "")}`;
  if (home && isUnder(path, home)) return `~/${path.slice(home.length).replace(/^\/+/, "")}`;
  return path;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Pure: the transcript lines for one context load. The first line always
 * lists what loaded; the hints follow only when the facts call for them.
 */
export function report(input: ReportInput): string[] {
  const { files, cwd, home } = input;
  if (files.length === 0) return ["Instructions loaded: none."];

  const bytes = files.reduce((n, f) => n + f.content.length, 0);
  const byKind = new Map<string, string[]>();
  let memoryCount = 0;
  for (const f of files) {
    if (f.kind === "memory") {
      memoryCount += 1;
      continue;
    }
    // An imported file shows as `+@name` after its importer, so a CLAUDE.md
    // that pulls in AGENTS.md reads `~/.claude/CLAUDE.md +@AGENTS.md`.
    const label = f.parent ? `+@${basename(f.path)}` : shortPath(f.path, cwd, home);
    const list = byKind.get(f.kind) ?? [];
    list.push(label);
    byKind.set(f.kind, list);
  }
  const parts: string[] = [];
  for (const kind of ["managed", "user", "project", "local"]) {
    const list = byKind.get(kind);
    if (list && list.length > 0) parts.push(`${kind} ${list.join(" ")}`);
  }
  if (memoryCount > 0) parts.push(`memory ${memoryCount}`);
  const lines = [`Instructions loaded (${files.length} files, ${kib(bytes)}): ${parts.join(" · ")}`];

  // A project-tier CLAUDE.md or CLAUDE.local.md is what the engine read
  // instead of the project's AGENTS.md (2.1.277 default mode).
  const projectClaude = files.filter(
    (f) => (f.kind === "project" || f.kind === "local") && !f.parent && PROJECT_CLAUDE_NAMES.has(basename(f.path)),
  );
  if (projectClaude.length > 0) {
    const names = projectClaude.map((f) => shortPath(f.path, cwd, home)).join(", ");
    const verb = input.projectAgentsMdExists === false ? "rename it to" : "merge it into";
    lines.push(
      `${names} is the project instructions here, so its AGENTS.md is not read (Claude Code 2.1.277+ reads AGENTS.md only where no CLAUDE.md exists). Run /cc migrate to ${verb} AGENTS.md, which Codex and Cursor read too.`,
    );
  }

  // The user CLAUDE.md cc-settings installs must import AGENTS.md; Claude Code
  // never reads ~/.claude/AGENTS.md on its own.
  const userClaude = files.find((f) => f.kind === "user" && !f.parent && basename(f.path) === "CLAUDE.md");
  if (userClaude) {
    const importsAgents = files.some((f) => f.parent === userClaude.path && basename(f.path) === "AGENTS.md");
    if (!importsAgents) {
      lines.push(
        `${shortPath(userClaude.path, cwd, home)} has no @AGENTS.md import, so the standards file is not loaded; rerun bash setup.sh (cc-settings 15.24.0+).`,
      );
    }
  }
  return lines;
}

// $ is never bound to a name: `claude plugin validate` requires every call on
// it to read as `$.noun.event(...)` at the call site.
export const register: Register = (on: On, _options: PluginOptions) => {
  let isInteractive = true;
  let lastReport = "";

  on("session.start", ($, event: SessionStartInput, next) => {
    isInteractive = event.isInteractive;
    return next(event);
  });

  on("prompt.context", async ($, event: PromptContextInput, next) => {
    // Report on what leaves the chain, not what enters it: the built-in
    // agents-md mod sits beneath this plugin and adds a project's AGENTS.md
    // files inside next(), so `event.instructionFiles` would miss them.
    const result = await next(event);
    const files = result.instructionFiles;
    // Undefined means a hook rewrote the claudeMd text; the files behind it
    // are unknown and there is nothing honest to report.
    if (files) {
      try {
        const cwd = await $.session.cwd();
        const home = await $.env.get("HOME");
        let projectAgentsMdExists: boolean | undefined;
        try {
          const [root, nested] = await Promise.all([
            $.fs.stat(`${cwd}/AGENTS.md`),
            $.fs.stat(`${cwd}/.claude/AGENTS.md`),
          ]);
          projectAgentsMdExists = root.kind === "file" || nested.kind === "file";
        } catch {
          projectAgentsMdExists = undefined;
        }
        const lines = report({ files, cwd, home, projectAgentsMdExists });
        const text = lines.join("\n");
        if (text !== lastReport) {
          lastReport = text;
          for (const line of lines) $.ui.log(line, { to: isInteractive ? "transcript" : "debug" });
        }
      } catch (error) {
        $.ui.log(`context-report: skipped (${error instanceof Error ? error.message : String(error)})`, {
          to: "debug",
        });
      }
    }
    return result;
  });
};
