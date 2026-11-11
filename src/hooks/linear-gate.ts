#!/usr/bin/env bun
// Linear Gate — PreToolUse hook (Bash). Blocks `gh pr create`, and a
// `gh pr edit` that sets a title, when the repo maps to a Linear team and no
// issue of a known team appears in the title, the body or the branch name.
// A known team is the mapped one or any other team the mapping names, since a
// repo can ship another team's issues. The ship skill's "Linear issue" step
// finds or creates the issue; this hook catches PRs opened any other way. A
// `git commit` on a branch that names no issue gets a reminder, never a block,
// so the ticket exists from kickoff.
//
// The mapping is read in the ship skill's order: ~/.claude/linear-teams.json,
// then the linear-map.json cache SessionStart keeps from team-knowledge. An
// unmapped repo, a repo mapped to null, and a cache older than a week
// (readLinearMap returns null) all pass. `CC_SKIP_LINEAR=1` in front of the
// command passes it once, for when Linear is unreachable. Fail-open.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { runGit } from "../lib/git.ts";
import { parseShellCommand, scanShell, splitPipes } from "../lib/hook-command.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";
import { type LinearMap, readLinearMap } from "../lib/knowledge-index.ts";
import { githubSlugFrom } from "../lib/team-knowledge.ts";

export const SKIP_VAR = "CC_SKIP_LINEAR";

const TeamsFileSchema = z.record(
  z.string(),
  z
    .object({ team: z.string().min(1), project: z.string().optional() })
    .passthrough()
    .nullable(),
);

export interface LinearTarget {
  team: string;
  project?: string;
}

export interface PrCommand {
  subcommand: "create" | "edit";
  title?: string;
  body?: string;
  bodyFile?: string;
  head?: string;
  repo?: string;
  fill: boolean;
  skip: boolean;
}

const SUBCOMMANDS: Record<string, PrCommand["subcommand"]> = {
  create: "create",
  new: "create",
  edit: "edit",
};

function flagValue(args: string[], i: number, long: string, short?: string): string | undefined {
  const a = args[i] as string;
  if (a === long || (short !== undefined && a === short)) return args[i + 1] ?? "";
  if (a.startsWith(`${long}=`)) return a.slice(long.length + 1);
  return undefined;
}

/** Every `gh pr create|new|edit` in a Bash command, with the flags this gate reads. */
export function prCommands(command: string): PrCommand[] {
  const found: PrCommand[] = [];
  for (const seg of scanShell(command).segments) {
    for (const stage of splitPipes(seg.clean)) {
      const { word, args, env } = parseShellCommand(stage);
      if (word !== "gh" || args[0] !== "pr") continue;
      const subcommand = SUBCOMMANDS[args[1] ?? ""];
      if (!subcommand) continue;
      const pr: PrCommand = { subcommand, fill: false, skip: env[SKIP_VAR] === "1" };
      for (let i = 2; i < args.length; i++) {
        const a = args[i] as string;
        if (a === "--fill" || a.startsWith("--fill-")) pr.fill = true;
        pr.title ??= flagValue(args, i, "--title", "-t");
        pr.body ??= flagValue(args, i, "--body", "-b");
        pr.bodyFile ??= flagValue(args, i, "--body-file", "-F");
        pr.head ??= flagValue(args, i, "--head", "-H");
        pr.repo ??= flagValue(args, i, "--repo", "-R");
      }
      found.push(pr);
    }
  }
  return found;
}

const GIT_OPTS_WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace"]);

/** True when a Bash command runs `git commit`, past git's global options. */
export function hasGitCommit(command: string): boolean {
  for (const seg of scanShell(command).segments) {
    for (const stage of splitPipes(seg.clean)) {
      const { word, args } = parseShellCommand(stage);
      if (word !== "git") continue;
      let i = 0;
      while (i < args.length && (args[i] as string).startsWith("-")) {
        i += GIT_OPTS_WITH_VALUE.has(args[i] as string) ? 2 : 1;
      }
      if (args[i] === "commit") return true;
    }
  }
  return false;
}

/** The mapping for `slug`: an entry, null for "no Linear here", undefined when unlisted. */
export function lookup(
  slug: string,
  teams: Record<string, LinearTarget | null> | null,
  map: LinearMap | null,
): LinearTarget | null | undefined {
  const key = slug.toLowerCase();
  for (const source of [teams, map]) {
    if (!source) continue;
    const hit = Object.entries(source).find(([k]) => k.toLowerCase() === key);
    if (hit) return hit[1] ? { team: hit[1].team, project: hit[1].project } : null;
  }
  return undefined;
}

/** Every team key the teams file and the map name, uppercased and deduped. */
export function teamKeys(
  teams: Record<string, LinearTarget | null> | null,
  map: LinearMap | null,
): string[] {
  const keys = new Set<string>();
  for (const source of [teams, map]) {
    for (const entry of Object.values(source ?? {})) {
      if (entry) keys.add(entry.team.toUpperCase());
    }
  }
  return [...keys];
}

// SHORTCUT: only keys of teams the mapping names count as issue IDs, so `UTF-8` or `GPT-6` never passes.
// ceiling: a PR for an issue of a team no repo maps to is blocked, and an unchecked `DR-99999` passes.
// upgrade: when that blocks real PRs or a bogus ID slips through review, confirm IDs through the Linear API.
export function hasIssueId(text: string, team: string | string[]): boolean {
  const keys = (Array.isArray(team) ? team : [team]).map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  if (keys.length === 0) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9])(?:${keys.join("|")})-\\d+(?![A-Za-z0-9])`, "i").test(text);
}

/** The mapped team first, then every other team the mapping knows. */
function acceptedKeys(
  target: LinearTarget,
  teams: Record<string, LinearTarget | null> | null,
  map: LinearMap | null,
): string[] {
  return [target.team, ...teamKeys(teams, map)];
}

export interface GateDeps {
  origin(cwd: string): Promise<string>;
  branch(cwd: string): Promise<string>;
  readTeams(): Promise<Record<string, LinearTarget | null> | null>;
  readMap(): Promise<LinearMap | null>;
  readText(path: string): Promise<string>;
}

async function readTeamsFile(): Promise<Record<string, LinearTarget | null> | null> {
  try {
    const raw = JSON.parse(await readFile(join(homedir(), ".claude", "linear-teams.json"), "utf8"));
    const parsed = TeamsFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const defaultDeps: GateDeps = {
  origin: (cwd) => runGit(["remote", "get-url", "origin"], { cwd }),
  branch: (cwd) => runGit(["branch", "--show-current"], { cwd }),
  readTeams: readTeamsFile,
  readMap: readLinearMap,
  readText: (path) => readFile(path, "utf8"),
};

/** The block reason for a command, or null when it may run. */
export async function gateReason(
  command: string,
  cwd: string,
  deps: GateDeps = defaultDeps,
): Promise<string | null> {
  const prs = prCommands(command).filter(
    (pr) => !pr.skip && (pr.subcommand === "create" || pr.title !== undefined),
  );
  if (prs.length === 0) return null;

  const [teams, map] = await Promise.all([deps.readTeams(), deps.readMap()]);
  for (const pr of prs) {
    const slug = pr.repo?.includes("/") ? pr.repo : githubSlugFrom(await deps.origin(cwd));
    if (!slug) continue;
    const target = lookup(slug, teams, map);
    if (!target) continue;

    const texts = [pr.title ?? "", pr.body ?? "", pr.head ?? (await deps.branch(cwd))];
    if (pr.bodyFile && pr.bodyFile !== "-") {
      const path = isAbsolute(pr.bodyFile) ? pr.bodyFile : join(cwd, pr.bodyFile);
      texts.push(await deps.readText(path).catch(() => ""));
    }
    if (texts.some((t) => hasIssueId(t, acceptedKeys(target, teams, map)))) continue;

    const project = target.project ? ` (project ${target.project})` : "";
    const fill = pr.fill ? " Drop --fill and write the title and body yourself." : "";
    return (
      `[Linear Gate] ${slug} maps to Linear team ${target.team}${project}, and this PR names no ${target.team} issue. ` +
      `Find or create one per the ship skill's "Linear issue" step, then retry with " (${target.team}-123)" at the end of the title and "Fixes ${target.team}-123" in the body.${fill} ` +
      `If Linear is unreachable, prefix the command with ${SKIP_VAR}=1 and tell the user the PR has no issue.`
    );
  }
  return null;
}

/** The reminder for a commit on a branch with no issue, or null. Never blocks. */
export async function commitReminder(
  command: string,
  cwd: string,
  deps: GateDeps = defaultDeps,
): Promise<string | null> {
  if (!hasGitCommit(command)) return null;
  const slug = githubSlugFrom(await deps.origin(cwd));
  if (!slug) return null;
  const [teams, map] = await Promise.all([deps.readTeams(), deps.readMap()]);
  const target = lookup(slug, teams, map);
  if (!target) return null;
  const branch = await deps.branch(cwd);
  // main and master are /ship's to branch off; a detached HEAD has no name to fix.
  if (!branch || branch === "main" || branch === "master") return null;
  if (hasIssueId(branch, acceptedKeys(target, teams, map))) return null;
  return (
    `[Linear Gate] Branch ${branch} names no ${target.team} issue, so this work has no ticket yet. ` +
    `Spawn the linear agent with event start now (the goal, why it matters, the plan, and what done means), ` +
    `then rename the branch to include the ID (git branch -m <type>/${target.team}-123-<slug>). The commit is not blocked.`
  );
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool, cwd } = await io.hookInput<{ tool_name: string; cwd: string }>({
    tool_name: "TOOL_NAME",
    cwd: "PWD",
  });
  if (tool !== "Bash") return;
  const { command } = await io.toolInput<{ command: unknown }>();
  if (typeof command !== "string") return;
  if (command.includes("gh")) {
    const reason = await gateReason(command, cwd || process.cwd());
    if (reason) io.block(reason);
  }
  if (command.includes("commit")) {
    const reminder = await commitReminder(command, cwd || process.cwd());
    if (reminder) io.context("PreToolUse", reminder);
  }
}

if (import.meta.main) await runHook(main);
