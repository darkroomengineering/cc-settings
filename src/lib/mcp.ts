// MCP server installation — ~/.claude.json is the only destination.
//
// WHY ONLY ~/.claude.json: Claude Code does not read `mcpServers` from
// settings.json at user scope. Measured three ways against the real binary — a
// server defined only in settings.json never appears in `claude mcp list`; with
// ~/.claude.json present but lacking the key, `claude mcp list` reports "No MCP
// servers configured" (so settings.json isn't even a fallback); and the official
// docs' configuration-locations table lists MCP storage as `~/.claude.json` /
// `.mcp.json`, never settings.json.
//
// cc-settings wrote the block to BOTH files until v12.16.0. That bought nothing
// and cost: a second ownership algorithm, an interactive preservation prompt
// guarding config nothing reads, and the H9 bug class — a defect whose entire
// content was the inert copy disagreeing with the real one. Removed per
// nuclear-review-2026-07-29 F6; pruneSettingsMcpServers below cleans up the
// block prior installs left behind.
//
// The critical invariants (inherited from the bash hardening pass):
//   1. Unparseable JSON → abort loudly. Never fall through to a cp that wipes
//      user-only MCPs.
//   2. All writes are atomic (tmp + rename, same directory).
//   3. User-only servers in ~/.claude.json survive by CONSTRUCTION, not by
//      prompt: installMcpToClaudeJson spreads existing entries last
//      (`{...teamMcp, ...effectiveCurrentMcp}`), so anything we don't ship is
//      untouched. This is why removing the settings.json prompt cost no
//      protection — the prompt only ever guarded the inert copy.
//
// Validation uses zod schemas:
//   - McpServers shape from src/schemas/mcp.ts (discriminated stdio vs http).
//   - ~/.claude.json uses a loose schema (Claude-Code-owned state we don't edit).
//
// Responsibilities of this file:
//   1. ~/.claude.json installation (installMcpToClaudeJson) and removal of
//      cc-settings-managed servers on light installs (removeManagedMcpServers)
//   2. One-time cleanup of the inert settings.json block
//      (pruneSettingsMcpServers)
//
// Generic JSON/atomic-file I/O moved to src/lib/json-io.ts; the pure settings.json
// merge strategies + orchestrator live in src/lib/settings-merge.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { McpStdioServer } from "../schemas/mcp.ts";
import { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { ENGINES, getEngine } from "./code-intel-engine.ts";
import { debug } from "./colors.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { asRecord, canonicalKey, subtractByKey } from "./merge-keyed.ts";
import { CLAUDE_DIR } from "./platform.ts";

type McpServer = z.infer<typeof McpServersSchema>[string];
export type McpServers = Record<string, McpServer>;

export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

// Server names cc-settings can generate more than one on-disk shape for via
// the code-intel engine indirection (src/lib/code-intel-engine.ts). Currently
// only "tldr" — every ENGINES descriptor shares the same mcpServerName.
const ENGINE_MANAGED_SERVER_NAMES: Set<string> = new Set(
  Object.values(ENGINES).map((e) => e.mcpServerName),
);

function isStdioServer(s: McpServer): s is McpStdioServer {
  return "command" in s;
}

/**
 * True when `entry` (an existing ~/.claude.json server definition) is stale
 * cc-settings output rather than a genuine user edit: it's byte-identical
 * (canonically) to `teamEntry` itself, or — for engine-managed server names —
 * to ANY code-intel engine variant cc-settings can generate for that server
 * (llm-tldr, native-ts, codebase-memory, …).
 *
 * Without this distinction, installMcpToClaudeJson's `{ ...teamMcp,
 * ...currentMcp }` user-wins-on-shared-key rule treats "cc-settings wrote
 * this on a PRIOR install with a different engine" identically to "the user
 * hand-edited this" — so switching CC_CODE_INTEL_ENGINE never actually
 * changes what ~/.claude.json runs (H8). A genuinely user-edited entry (one
 * that matches none of these candidates) still returns false and wins, same
 * as before.
 *
 * `priorWritten`, when supplied, is an exact echo of what THIS server name got
 * written to disk on the run that stamped the current sentinel (see
 * `mcp_written` in src/setup.ts writeVersionSentinel). The live-registry loop
 * above can only recognize shapes the CURRENT code would generate — the
 * moment a descriptor's serverInstructions text changes (as happened across
 * v12.8.1 / v12.9.0), yesterday's output stops matching any live candidate and
 * gets misclassified as a hand-edit. `priorWritten` closes that gap: it is
 * recorded fact, not derived from code that may have since changed. A genuine
 * hand-edit still differs from `priorWritten` too (by construction — it's an
 * exact echo of what cc-settings itself wrote), so it still falls through to
 * `false` below.
 */
function isStaleCcOutput(
  name: string,
  entry: McpServer,
  teamEntry: McpServer,
  priorWritten?: McpServer,
): boolean {
  if (functionalKey(entry) === functionalKey(teamEntry)) return true;
  if (priorWritten && functionalKey(entry) === functionalKey(priorWritten)) return true;
  if (!ENGINE_MANAGED_SERVER_NAMES.has(name)) return false;
  if (!isStdioServer(entry) || !isStdioServer(teamEntry)) return false;
  for (const id of Object.keys(ENGINES)) {
    const finalized = getEngine(id, CLAUDE_DIR);
    const candidate: McpStdioServer = {
      ...teamEntry,
      command: finalized.mcp.command,
      args: finalized.mcp.args,
      serverInstructions: finalized.serverInstructions,
    };
    if (functionalKey(entry) === functionalKey(candidate)) return true;
  }
  return false;
}

/**
 * `_`-prefixed keys are documentation-only annotations (`_status`, `_comment`,
 * `_description`, …) that Claude Code ignores and the settings composer strips.
 * They say nothing about how a server RUNS, so two definitions differing only
 * in them are the same server.
 *
 * This matters because equality here decides ownership. Older installs wrote
 * `_status`/`_comment` inline; those keys survive in ~/.claude.json and made an
 * otherwise byte-identical entry compare unequal to ours — so isStaleCcOutput
 * called it a hand-edit, the merge preserved it, and cc-settings' own updates
 * to that server could never land again. Comparing on functional fields only
 * lets those entries be recognized and refreshed, while a genuine customization
 * (different command/args/url/headers) still differs and is still preserved.
 */
// Exactly the keys `mcpCommentary` in src/schemas/mcp.ts documents as
// commentary. Deliberately a closed list rather than a `_`-prefix test: an
// unknown `_`-prefixed field might be a real Claude Code extension we don't
// model yet, and treating it as decoration would let the merge overwrite it.
// Unknown `_` keys therefore still count as a divergence — fail safe.
// `serverInstructions` is NOT here; Claude Code reads it, so it is functional.
const ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  "_comment",
  "_description",
  "_usage",
  "_contextCost",
  "_status",
]);

function stripAnnotations(v: unknown): unknown {
  const rec = asRecord(v);
  if (!rec) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (!ANNOTATION_KEYS.has(k)) out[k] = val;
  }
  return out;
}

/** True when two entries carry the same annotation keys and values. Used only by
 *  pruneSettingsMcpServers: functional equality decides whether an entry RUNS the
 *  same, but an annotation the user added is content they authored, and deleting
 *  it needs a higher bar than "runs the same as ours". */
function annotationsMatch(a: unknown, b: unknown): boolean {
  const pick = (v: unknown): Record<string, unknown> => {
    const rec = asRecord(v);
    if (!rec) return {};
    const out: Record<string, unknown> = {};
    for (const k of ANNOTATION_KEYS) if (k in rec) out[k] = rec[k];
    return out;
  };
  return canonicalKey(pick(a)) === canonicalKey(pick(b));
}

/** canonicalKey over functional fields only — annotation-blind, order-blind. */
export function functionalKey(v: unknown): string {
  return canonicalKey(stripAnnotations(v));
}

export async function installMcpToClaudeJson(
  teamMcp: McpServers,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
  mcpWritten?: Record<string, unknown> | null,
): Promise<string[]> {
  if (Object.keys(teamMcp).length === 0) {
    debug("No MCP servers in team config");
    return [];
  }

  // Read existing claude.json — tolerate absence, but don't tolerate corruption.
  // readJsonOrNull throws JsonParseError on unparseable JSON (surfaced loudly at
  // the setup.ts top-level catch); a missing file reads as {}.
  const parsed = (await readJsonOrNull(claudeJsonPath)) ?? {};

  // The file must be a JSON object to merge Claude-Code state through. A
  // top-level array or scalar is genuinely unmergeable — THROW (setup exits 1)
  // rather than silently skipping the MCP install while still reporting success.
  //
  // We deliberately do NOT run ClaudeJson.safeParse here. That schema validates
  // `mcpServers` too, so a single drifted server entry (a forward-compat shape
  // we don't model yet) failed this outer gate and returned early — making the
  // raw-preserving fallback below, built for exactly that case, unreachable.
  // Validating only the object shape here lets mcpServers drift flow to that
  // fallback (preserved, not dropped), while still failing loud on real garbage.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${claudeJsonPath} is not a JSON object (found ${Array.isArray(parsed) ? "array" : typeof parsed}) — ` +
        "refusing to merge MCP servers. Fix or remove the file, then re-run setup.",
    );
  }
  const current = parsed as Record<string, unknown>;

  // Validate existing servers from ~/.claude.json. On schema failure we log a
  // warning but keep the raw value — forward-compat drift (new Claude Code
  // server shapes we don't know yet) should NOT cause us to silently drop user
  // servers. Safety > strict correctness at a write-back boundary.
  const currentMcpRaw = current.mcpServers;
  let currentMcp: McpServers = {};
  if (currentMcpRaw !== undefined) {
    const currentResult = McpServersSchema.safeParse(currentMcpRaw);
    if (currentResult.success) {
      currentMcp = currentResult.data;
    } else if (
      typeof currentMcpRaw === "object" &&
      currentMcpRaw !== null &&
      !Array.isArray(currentMcpRaw)
    ) {
      // The map is a real object but failed schema validation — preserve it
      // PER ENTRY: keep object-shaped entries (valid servers, or forward-compat
      // shapes we don't model yet) and drop null/scalar/array entries. Downstream
      // stale-output detection does `"command" in entry` (isStdioServer), which
      // throws on a non-object — so a single bad entry must not ride along, even
      // though the surrounding map is worth preserving.
      debug(
        `Existing MCP servers in ${claudeJsonPath} failed schema validation (preserving valid-shaped entries): ${currentResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      const preserved: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(currentMcpRaw)) {
        if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
          preserved[name] = entry;
        } else {
          debug(
            `Dropping non-object MCP entry "${name}" in ${claudeJsonPath} (${Array.isArray(entry) ? "array" : entry === null ? "null" : typeof entry}).`,
          );
        }
      }
      currentMcp = preserved as McpServers;
    } else {
      // A non-object mcpServers (array/scalar/null) can't be merged without
      // silently discarding whatever the user had there. Refuse loudly rather
      // than overwrite it — the same fail-closed posture as a non-object
      // claude.json above. (A missing mcpServers is undefined and handled by
      // the outer guard, so this only fires on a genuinely malformed value.)
      throw new Error(
        `${claudeJsonPath} has a non-object "mcpServers" (${Array.isArray(currentMcpRaw) ? "array" : typeof currentMcpRaw}) — ` +
          "refusing to overwrite it. Fix or remove the field, then re-run setup.",
      );
    }
  }
  // Drop currentMcp entries that are stale cc-settings output (this or a prior
  // install's engine choice) before the user-wins spread below — otherwise a
  // resolved engine change in teamMcp (e.g. CC_CODE_INTEL_ENGINE=native-ts)
  // never reaches ~/.claude.json, because the stale entry always looks like a
  // "user override" to the spread. Genuinely user-edited entries (matching
  // neither the team entry nor any known engine variant) are left untouched.
  const effectiveCurrentMcp: McpServers = {};
  for (const [name, entry] of Object.entries(currentMcp)) {
    const teamEntry = teamMcp[name];
    const priorWritten = mcpWritten?.[name] as McpServer | undefined;
    if (teamEntry && isStaleCcOutput(name, entry, teamEntry, priorWritten)) continue;
    effectiveCurrentMcp[name] = entry;
  }

  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...effectiveCurrentMcp };
  const next = { ...current, mcpServers: mergedMcp };
  await atomicWriteJson(claudeJsonPath, next);
  debug(`Installed MCP servers to ${claudeJsonPath}`);

  // Shipped names the user's own definition shadowed. The install summary marks
  // these so "cc-settings ships this server" is never read as "cc-settings'
  // definition is what's running" — the distinction that let a stale entry sit
  // unnoticed through repeated installs.
  return Object.keys(teamMcp).filter((name) => name in effectiveCurrentMcp);
}

/**
 * Remove cc-settings-managed MCP servers from ~/.claude.json, preserving
 * any user-only servers. Called during a light install — light has no team
 * MCP servers, so the full install's context7 etc. must be removed.
 */
export async function removeManagedMcpServers(
  fullComposed: Record<string, unknown>,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
): Promise<void> {
  const fullMcp = asRecord(fullComposed.mcpServers);
  if (Object.keys(fullMcp).length === 0) return;

  const parsed = await readJsonOrNull(claudeJsonPath);
  if (!parsed || typeof parsed !== "object") return;
  const current = parsed as Record<string, unknown>;
  const currentMcp = asRecord(current.mcpServers);

  // Keep only the servers that are NOT cc-settings-managed (absent from the
  // full baseline) — keyed subtraction on the server name.
  const kept = subtractByKey(Object.entries(currentMcp), Object.entries(fullMcp), ([key]) => key);

  const updated = { ...current };
  if (kept.length === 0) {
    delete updated.mcpServers;
  } else {
    updated.mcpServers = Object.fromEntries(kept);
  }
  await atomicWriteJson(claudeJsonPath, updated);
}

// --- MCP-preserving settings.json merge ----------------------------------

/**
 * One-time cleanup: remove the inert `mcpServers` block a pre-v12.16.0 install
 * wrote into settings.json. Claude Code never read it (see this file's header),
 * so leaving it behind would be stale config that looks authoritative.
 *
 * Deliberately conservative about what it removes. An entry goes only when we
 * can show cc-settings put it there:
 *   - its name + functional shape matches what we ship now, OR
 *   - it matches what the `mcp_written` sentinel records this installer wrote
 *     previously (including a prior engine's `tldr` shape).
 * Anything else — a server the user added by hand — stays, even though it is
 * equally inert there. Removing a user's line because we believe it useless is
 * not this function's call to make.
 *
 * The `mcpServers` key itself is dropped when the prune empties it, so a clean
 * install leaves no empty object behind. Idempotent: a second run finds nothing.
 *
 * @returns names removed (empty when there was nothing to do)
 */
export async function pruneSettingsMcpServers(
  settingsPath: string,
  teamMcp: McpServers,
  mcpWritten?: Record<string, unknown> | null,
): Promise<string[]> {
  // readJsonOrNull throws on unparseable JSON — same fail-loud posture as the
  // rest of this module. A missing settings.json is simply nothing to prune.
  const raw = (await readJsonOrNull(settingsPath)) as Record<string, unknown> | null;
  if (!raw) return [];
  const existing = raw.mcpServers;
  if (existing === undefined) return [];
  // A non-object value is not ours and is not safely mergeable — leave it alone
  // rather than guess. asRecord() would silently flatten it to {}.
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return [];

  const kept: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [name, entry] of Object.entries(existing)) {
    // A non-object entry is not something cc-settings wrote, and handing it to
    // isStaleCcOutput would THROW: for an engine-managed name (`tldr`) that
    // function reaches `isStdioServer`, which does `"command" in entry`. One
    // junk entry in an otherwise-parseable settings.json would abort the whole
    // install. Keep it and move on.
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      kept[name] = entry;
      continue;
    }
    const server = entry as McpServer;
    const teamEntry = teamMcp[name];
    const priorWritten = mcpWritten?.[name] as McpServer | undefined;
    // Ours when it matches what we ship now, OR — for a server cc-settings has
    // since RETIRED, where teamMcp has no entry to compare against — when it
    // matches what the sentinel records a previous install wrote. Without the
    // second case a retired server's inert block could never be pruned, and the
    // ownership evidence disappears on the next sentinel write.
    // Ownership by RECORDED FACT: matches what the sentinel says we wrote.
    // Annotation-blind is fine here — provenance is not inferred.
    const byProvenance =
      priorWritten !== undefined && functionalKey(server) === functionalKey(priorWritten);
    // Ownership INFERRED from shape, for a pre-v12.12.0 sentinel with no record.
    // Requires the annotations to match too: a user who copied our entry and
    // added their own `_comment` must keep it, and a functional-only comparison
    // would call that ours and silently drop their note — contradicting this
    // function's own promise to leave hand-added content alone.
    const byShape =
      teamEntry !== undefined &&
      isStaleCcOutput(name, server, teamEntry, priorWritten) &&
      annotationsMatch(server, priorWritten ?? teamEntry);
    const isOurs = byProvenance || byShape;
    if (isOurs) removed.push(name);
    else kept[name] = entry;
  }
  if (removed.length === 0) return [];

  const next: Record<string, unknown> = { ...raw };
  if (Object.keys(kept).length === 0) delete next.mcpServers;
  else next.mcpServers = kept;
  await atomicWriteJson(settingsPath, next);
  debug(`Pruned inert settings.json mcpServers entries: ${removed.join(", ")}`);
  return removed;
}
