// Install display helpers — extracted from src/setup.ts (§1.1).
//
// Pure output rendering: countEntries, showSummary, cmdDryRun, printStatus.
// No coupling to install execution; import them from setup.ts's install phases.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { boxEnd, boxLine, boxStart, palette, success, warn } from "./colors.ts";
import { readJsonOrNull } from "./json-io.ts";
import { LIGHT_SKILLS, PROFILE_MANIFEST } from "./light-profile.ts";
import { CLAUDE_JSON_PATH } from "./mcp.ts";
import { CLAUDE_DIR } from "./platform.ts";
import type { StatusData } from "./status-types.ts";

// The count helpers take an absolute directory so they're pure and unit-testable
// against a temp dir (CLAUDE_DIR is fixed at import, so callers join it in).

/** Count immediate entries of `full` whose name matches `pattern`. */
export async function countEntries(full: string, pattern: RegExp): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full);
    return entries.filter((e) => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

/**
 * Count installed skills. Unlike the other manifest dirs (flat `*.md` files),
 * skills are subdirectories each holding a `SKILL.md`, so a `/\.md$/` match on
 * the top level only ever finds `README.md` and reports 1. Count subdirs that
 * actually contain a `SKILL.md` instead.
 */
export async function countSkillDirs(full: string): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && existsSync(join(full, e.name, "SKILL.md")))
      .length;
  } catch {
    return 0;
  }
}

/**
 * Count entries matching `pattern` anywhere under `full`. `docs/` keeps some
 * files in subdirs (plans/, upstream-bugs/, …) that the installer copies
 * recursively, so a top-level-only count undercounts what lands in ~/.claude.
 */
export async function countEntriesRecursive(full: string, pattern: RegExp): Promise<number> {
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full, { recursive: true });
    return entries.filter((e) => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

export async function showSummary(profile: "full" | "light"): Promise<void> {
  const profileLabel = profile === "light" ? " [light]" : "";
  console.log("");
  boxStart(`Installed${profileLabel}`);
  if (profile === "light") {
    boxLine("ok", "settings.json ($schema + statusLine only)");
    for (const skill of LIGHT_SKILLS) boxLine("ok", `skills/${skill}`);
    boxLine("ok", "src/      (TS; statusLine + libs)");
    boxLine("ok", "memory/");
  } else {
    // Rendered from PROFILE_MANIFEST so the summary can't drift from what
    // installConfigFiles actually copies. Dirs with installed .md files show
    // a count; container dirs (skills/) just list.
    const ROOT_FILE_LABELS: Record<string, string> = {
      "CLAUDE.md": "(Claude-Code config)",
      "AGENTS.md": "(portable standards)",
    };
    const manifest = PROFILE_MANIFEST.full;
    for (const [, dest] of manifest.rootFiles) {
      const label = ROOT_FILE_LABELS[dest];
      boxLine("ok", label ? `${dest} ${label}` : dest);
    }
    boxLine("ok", "settings.json (TS hooks)");
    boxLine("ok", "~/.claude.json (MCP servers)");
    const counts = await Promise.all(
      manifest.dirs.map((d) => {
        const full = join(CLAUDE_DIR, d);
        if (d === "skills") return countSkillDirs(full);
        if (d === "docs") return countEntriesRecursive(full, /\.md$/);
        return countEntries(full, /\.md$/);
      }),
    );
    manifest.dirs.forEach((d, i) => {
      const n = counts[i] ?? 0;
      boxLine("ok", n > 0 ? `${d}/ (${n})` : `${d}/`);
    });
    boxLine("ok", "src/      (TS; hooks + scripts + libs + schemas)");
    boxLine("ok", "memory/");
  }
  boxEnd();

  if (profile === "light") {
    console.log("");
    console.log(
      `${palette.dim}Light profile: raw Claude Code · statusLine · share-learning skill only${palette.reset}`,
    );
    console.log(
      `${palette.dim}No CLAUDE.md, AGENTS.md, MCP servers, hooks, or effort override.${palette.reset}`,
    );
    console.log(`${palette.dim}Re-run without --light to upgrade to full.${palette.reset}`);
  }

  const claudeJson = (await readJsonOrNull(CLAUDE_JSON_PATH)) as {
    mcpServers?: Record<string, { _status?: unknown }>;
  } | null;
  const servers = Object.entries(claudeJson?.mcpServers ?? {});
  if (servers.length > 0) {
    console.log("");
    console.log(`${palette.bold}MCP servers in ~/.claude.json:${palette.reset}`);
    // Group by `_status` annotation. Servers without a status are listed as
    // "user-added" — they came from the user's machine, not the team config.
    const core: string[] = [];
    const optional: string[] = [];
    const userAdded: string[] = [];
    for (const [name, server] of servers) {
      const status = (server as { _status?: unknown })._status;
      if (status === "core") core.push(name);
      else if (status === "optional") optional.push(name);
      else userAdded.push(name);
    }
    if (core.length > 0) {
      console.log(`  ${palette.dim}core:${palette.reset}`);
      for (const s of core) console.log(`    - ${s}`);
    }
    if (optional.length > 0) {
      console.log(`  ${palette.dim}optional (manually added):${palette.reset}`);
      for (const s of optional) console.log(`    - ${s}`);
    }
    if (userAdded.length > 0) {
      console.log(`  ${palette.dim}user-added:${palette.reset}`);
      for (const s of userAdded) console.log(`    - ${s}`);
    }
  }
}

export async function cmdDryRun(
  source: string,
  profile: "full" | "light",
  version: string,
): Promise<void> {
  const profileLabel = profile === "light" ? " [light profile]" : "";
  console.log(`cc-settings installer v${version} — dry-run${profileLabel}`);
  console.log(`source: ${source}`);
  console.log(`target: ${CLAUDE_DIR}`);
  console.log("");

  if (profile === "light") {
    console.log("Would install (light = raw Claude Code + statusLine + share-learning):");
    const items: Array<[string, string]> = [
      ...LIGHT_SKILLS.map((s): [string, string] => [`skills/${s}/`, `→ ~/.claude/skills/${s}/`]),
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ["config/", "→ ~/.claude/settings.json ($schema + statusLine only)"],
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(28)} ${effect}`);
    }
    console.log("");
    console.log("Light profile: no CLAUDE.md · no AGENTS.md · no MCP servers · no hooks");
    console.log("               no agents · no rules · no profiles · no docs");
    console.log("               default Claude Code permissions · default effort");
  } else {
    console.log("Would install:");
    // Rendered from PROFILE_MANIFEST so the dry-run table can't drift from
    // what installConfigFiles actually copies.
    const items: Array<[string, string]> = [
      ...PROFILE_MANIFEST.full.rootFiles.map(([src, dest]): [string, string] => [
        src,
        `→ ~/.claude/${dest}`,
      ]),
      ["config/", "→ ~/.claude/settings.json (composed + MCP-merged)"],
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ...PROFILE_MANIFEST.full.dirs.map((d): [string, string] => [`${d}/`, `→ ~/.claude/${d}/`]),
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(22)} ${effect}`);
    }
  }

  console.log("");
  console.log("No files written. Re-run without --dry-run to install.");
}

export function printStatus(data: StatusData): void {
  console.log("cc-settings --status");
  console.log("");

  // Installed version
  if (data.sentinel.version) {
    const profileLabel = data.sentinel.profile ? ` [${data.sentinel.profile}]` : "";
    console.log(
      `  installed: v${data.sentinel.version}${profileLabel}  (${data.sentinel.installedAt ?? "unknown"})`,
    );
  } else {
    console.log(
      `  installed: ${palette.yellow}none${palette.reset}  (no sentinel at ~/.claude/.cc-settings-version)`,
    );
  }
  console.log(`  packaged:  v${data.packagedVersion}`);

  // Git drift
  if (data.git?.sha) {
    const g = data.git;
    const driftNote =
      g.behind === null
        ? "(sentinel absent — can't compute drift)"
        : g.behind === 0
          ? `${palette.green}up to date${palette.reset}`
          : `${palette.yellow}${g.behind} commit(s) since install${palette.reset}`;
    console.log(`  repo HEAD: ${g.sha}  ${driftNote}`);
  }

  console.log("");
  console.log("Managed skills:");
  console.log(`  present: ${data.skills.presentCount}/${data.skills.shippedCount}`);
  if (data.skills.missing.length > 0) {
    console.log(`  missing: ${data.skills.missing.join(", ")}`);
  }

  console.log("");
  console.log("Hooks:");
  console.log(
    `  events registered: ${data.hooks.events.length}  (${data.hooks.groupCount} group(s) total)`,
  );
  if (data.hooks.events.length > 0) {
    console.log(`  ${data.hooks.events.sort().join(", ")}`);
  }

  console.log("");
  console.log("Env vars:");
  for (const { key, value } of data.envVars) {
    const mark =
      value === undefined
        ? `${palette.yellow}✗${palette.reset}`
        : `${palette.green}✓${palette.reset}`;
    const val = value === undefined ? "(unset)" : value;
    console.log(`  ${mark} ${key}=${val}`);
  }

  console.log("");
  console.log("Permissions:");
  console.log(`  allow: ${data.permissions.allowCount}  deny: ${data.permissions.denyCount}`);

  console.log("");
  console.log("MCP servers:");
  const { servers } = data.mcp;
  console.log(
    `  configured: ${servers.length}${servers.length > 0 ? `  (${servers.join(", ")})` : ""}`,
  );

  console.log("");

  if (data.warnings.length === 0) {
    success("all checks passed");
  } else {
    for (const { message } of data.warnings) warn(message);
  }
}
