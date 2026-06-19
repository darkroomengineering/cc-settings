// Supply-chain defense scanner. Reads ~/.claude/settings.json, walks every
// hook command across every event, classifies each as trusted/unknown/
// suspicious. Motivated by the Shai-Hulud npm worm (May 2026) which writes
// SessionStart hooks into settings.json that survive `npm uninstall` and
// re-execute on every Claude Code session.
//
// Classification rules:
//   trusted    — matches cc-settings' shipped command pattern
//                (`bun "$HOME/.claude/src/{scripts,hooks}/<name>.ts"`)
//                AND the referenced file's content hash matches the install
//                manifest written by setup.ts. Trust is content-based, not
//                path-based: a path-shaped match alone proves nothing, since
//                malware can drop ~/.claude/src/hooks/evil.ts or patch a
//                shipped script in place (see SECURITY.md).
//   stale      — matches the shipped pattern, but the script file no longer
//                exists on disk. Leftover from a hook rename/removal in a past
//                cc-settings release. Harmless but noisy; re-run setup.sh.
//   suspicious — matches a high-confidence malware signature (curl|wget piping
//                to a shell, base64 decode + exec, eval, /tmp/ exec, node/python
//                -e or -c, long single-line opaque commands), OR is path-shaped
//                and the file EXISTS on disk but fails content verification
//                against the install manifest (possible dropped/patched payload).
//   unknown    — neither. User-added custom hooks land here, as do shipped-
//                pattern commands when no install manifest exists (pre-manifest
//                install). They're not inherently bad; they just haven't been
//                vouched for.
//
// Exit code policy (CLI):
//   suspicious findings → exit 1
//   stale-only or unknown-only findings → exit 0, but surface for review
//   nothing found → exit 0

import { existsSync } from "node:fs";
import { join } from "node:path";
import { HooksBlock } from "../schemas/hooks.ts";
import { parseHookCommand } from "./hook-command.ts";
import { hashFileOrNull, readSrcManifest } from "./hooks-fingerprint.ts";
import { readJsonOrNull } from "./json-io.ts";
import { CLAUDE_DIR } from "./platform.ts";

export type HookSeverity = "trusted" | "unknown" | "stale" | "suspicious";

export interface HookFinding {
  event: string;
  groupIndex: number;
  hookIndex: number;
  type: string;
  command: string;
  severity: HookSeverity;
  reasons: string[];
}

/** Schema-validation meta-finding — distinguishes schema failures from real hook findings. */
export interface SchemaFinding {
  event: "schema";
  groupIndex: -1;
  hookIndex: -1;
  type: "schema-validation";
  command: string;
  severity: "unknown";
  reasons: string[];
}

/** Discriminated union of audit findings. */
export type AuditFinding = HookFinding | SchemaFinding;

export interface AuditResult {
  settingsPath: string;
  exists: boolean;
  totalHooks: number;
  findings: AuditFinding[];
}

/** Content-integrity view consumed by the classifier: rel path under
 *  ~/.claude/src - does the on-disk content hash match the install manifest?
 *  `null`/absent means no manifest exists - classification degrades to
 *  "unknown" for shipped-pattern commands rather than trusting path shape.
 *  `fileExists` answers whether a given rel path is currently present on disk
 *  (independent of the manifest), used to distinguish stale entries (file gone)
 *  from dropped-payload entries (file exists but isn't manifested). */
export interface SrcIntegrity {
  files: Map<string, boolean>;
  fileExists: (rel: string) => boolean;
}

/** Build the SrcIntegrity view: every manifested file, hashed on disk and
 *  compared. Returns null when no manifest exists (pre-manifest install) or
 *  on any read error - fail-soft, never throws. */
export async function loadSrcIntegrity(claudeDir?: string): Promise<SrcIntegrity | null> {
  try {
    const dir = claudeDir ?? CLAUDE_DIR;
    const manifest = await readSrcManifest(dir);
    if (!manifest) return null;
    const files = new Map<string, boolean>();
    for (const [rel, expected] of Object.entries(manifest.files)) {
      files.set(rel, (await hashFileOrNull(join(dir, "src", rel))) === expected);
    }
    return { files, fileExists: (rel) => existsSync(join(dir, "src", rel)) };
  } catch {
    return null;
  }
}

// NOTE: The managed pattern lives in hook-command.ts (MANAGED_HOOK_CMD).
// It is (scripts|hooks) ONLY - lib/ files are support modules, not hooks,
// and were dropped from the trusted surface in the nuclear-review refactor.
// [ \t] (not \s) arg-separation is preserved from the original, see hook-command.ts.

/** Classify a single shipped-pattern command against the install manifest. */
function classifyShippedPath(
  rel: string,
  integrity: SrcIntegrity | null | undefined,
): { severity: HookSeverity; reasons: string[] } {
  if (integrity === undefined || integrity === null) {
    return {
      severity: "unknown",
      reasons: [
        "matches cc-settings shipped script pattern, but no install manifest — cannot verify content",
      ],
    };
  }
  const verified = integrity.files.get(rel);
  if (verified === undefined) {
    if (!integrity.fileExists(rel)) {
      return {
        severity: "stale",
        reasons: [
          `src/${rel}: references a cc-settings script that no longer exists on disk — stale entry from a hook rename/removal; re-run setup.sh to prune it`,
        ],
      };
    }
    return {
      severity: "suspicious",
      reasons: [`src/${rel}: file not in install manifest (possible dropped payload)`],
    };
  }
  if (!verified) {
    return {
      severity: "suspicious",
      reasons: [`src/${rel}: file hash differs from install manifest (possible patched payload)`],
    };
  }
  return {
    severity: "trusted",
    reasons: ["matches cc-settings shipped script pattern; content matches install manifest"],
  };
}

// Compound command separator regex. Splits on ; && || and newline variants
// including U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR.
// Built via new RegExp so \uNNNN escapes stay as explicit codepoints in the
// source text rather than invisible literal characters (encoding-safe).
const COMPOUND_SEP = /\s*(?:;|&&|\|\||\r?\n|\r|\u2028|\u2029)\s*/;

// Compound commands that chain multiple trusted bun scripts with `;` or `&&`.
// Each sub-command must match MANAGED_HOOK_CMD *and* pass content verification;
// the compound's severity is the worst of its parts.
function classifyCompound(
  cmd: string,
  integrity: SrcIntegrity | null | undefined,
): { severity: HookSeverity; reasons: string[] } | null {
  const parts = cmd.split(COMPOUND_SEP).filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  // Parse each part via the shared managed-command parser (drops lib/).
  // SECURITY: trust requires EVERY part to be managed (incl. `||` branches — a
  // failure-path command still runs). Never relax this `every` to `some`, or a
  // `managed || evil` compound would classify as trusted.
  const parsed = parts.map((p) => parseHookCommand(p));
  if (!parsed.every((p) => p.managed && p.relPath)) return null;

  const results = parsed.map((p) => classifyShippedPath(p.relPath ?? "", integrity));
  const suspicious = results.filter((r) => r.severity === "suspicious");
  if (suspicious.length > 0) {
    return { severity: "suspicious", reasons: suspicious.flatMap((r) => r.reasons) };
  }
  const staleResults = results.filter((r) => r.severity === "stale");
  if (staleResults.length > 0) {
    return { severity: "stale", reasons: staleResults.flatMap((r) => r.reasons) };
  }
  if (results.some((r) => r.severity === "unknown")) {
    return {
      severity: "unknown",
      reasons: [
        "chains cc-settings shipped scripts, but no install manifest — cannot verify content",
      ],
    };
  }
  return {
    severity: "trusted",
    reasons: ["chains multiple cc-settings shipped scripts; content matches install manifest"],
  };
}

// Strong signals of supply-chain malware in a hook command. These are
// patterns benign hooks have no reason to use, and ALL appear in the
// Shai-Hulud worm payload pattern reported by Snyk/Socket/Wiz (May 2026).
const SUSPICIOUS_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  {
    rx: /curl[^|]*\|\s*(sh|bash|zsh|node|python)/i,
    reason: "pipes curl output to a shell/interpreter",
  },
  {
    rx: /wget[^|]*\|\s*(sh|bash|zsh|node|python)/i,
    reason: "pipes wget output to a shell/interpreter",
  },
  {
    rx: /\bbase64\b.*\|\s*(sh|bash|zsh|node|python)/i,
    reason: "decodes base64 and pipes to shell",
  },
  { rx: /\beval\b\s*[("$`]/, reason: "uses eval on dynamic input" },
  { rx: /\bnode\s+-e\b/i, reason: "executes inline JS via node -e" },
  { rx: /\bpython3?\s+-c\b/i, reason: "executes inline Python via python -c" },
  { rx: /(^|[^a-zA-Z_])\/tmp\/[a-zA-Z0-9._-]+/, reason: "references a /tmp/ executable" },
  {
    rx: /\b\.npmrc\b|\bnode_modules\/\.[a-zA-Z0-9._-]+\/(bin|tmp)\//,
    reason: "references a hidden node_modules path",
  },
  { rx: /atob\s*\(/i, reason: "uses atob (base64 decode) — common in obfuscated payloads" },
  {
    rx: /\$\(\s*echo\s+[A-Za-z0-9+/=]{60,}\s*\|/,
    reason: "echoes a long base64 blob into a subshell",
  },
];

// Quick "is this obviously a one-liner blob of opaque code?" check.
function looksOpaque(cmd: string): boolean {
  if (cmd.length < 250) return false;
  // No spaces in long runs -> likely obfuscated/encoded. reduce (not spread)
  // because `cmd` is arbitrary settings.json text - a pathological token count
  // would blow the call stack with Math.max(...tokens).
  const longestRun = cmd.split(/\s/).reduce((m, s) => Math.max(m, s.length), 0);
  if (longestRun > 200) return true;
  // High density of base64 alphabet -> encoded payload
  const b64Chars = (cmd.match(/[A-Za-z0-9+/=]/g) ?? []).length;
  return b64Chars / cmd.length > 0.85;
}

function matchSuspicious(cmd: string): string[] {
  const reasons: string[] = [];
  for (const { rx, reason } of SUSPICIOUS_PATTERNS) {
    if (rx.test(cmd)) reasons.push(reason);
  }
  if (looksOpaque(cmd)) reasons.push("long single-token blob (likely obfuscated payload)");
  return reasons;
}

export function classifyHookCommand(
  cmd: string,
  integrity?: SrcIntegrity | null,
): { severity: HookSeverity; reasons: string[] } {
  // Malware signatures are checked FIRST and unconditionally - a hit always
  // wins, even when the command would otherwise match the shipped pattern and
  // verify against the manifest. Defense in depth: MANAGED_HOOK_CMD already
  // rejects shell metacharacters in trailing args, but pattern-match trust
  // must never suppress an explicit malware signal.
  const sus = matchSuspicious(cmd);
  if (sus.length > 0) return { severity: "suspicious", reasons: sus };

  // Shipped-pattern commands next. Trust is CONTENT-based (install manifest),
  // not path-based. lib/ files are NOT in the managed pattern (tightened).
  const parsed = parseHookCommand(cmd);
  if (parsed.managed && parsed.relPath) {
    return classifyShippedPath(parsed.relPath, integrity);
  }
  const compound = classifyCompound(cmd, integrity);
  if (compound) return compound;

  return {
    severity: "unknown",
    reasons: ["does not match cc-settings shipped pattern — review manually"],
  };
}

// Settings.json shape we care about: top-level `hooks` is `{ [event]: HookGroup[] }`
// where each group has `hooks: Hook[]`. We tolerate unknown shapes silently
// (return empty findings) - a malformed settings.json is a different problem.

export function auditHooks(settings: unknown, integrity?: SrcIntegrity | null): HookFinding[] {
  if (!settings || typeof settings !== "object") return [];
  const hooks = (settings as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object") return [];

  const findings: HookFinding[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group: unknown, gi: number) => {
      if (!group || typeof group !== "object") return;
      const hooksBlock = (group as Record<string, unknown>).hooks;
      if (!Array.isArray(hooksBlock)) return;
      hooksBlock.forEach((entry: unknown, hi: number) => {
        if (!entry || typeof entry !== "object") return;
        const e = entry as Record<string, unknown>;
        // Only `command`-type hooks have a string command. Prompt/agent/http/
        // mcp_tool hooks don't run arbitrary shell, so out of scope here.
        if (e.type !== "command") return;
        if (typeof e.command !== "string") return;
        const cmd = e.command.trim();
        if (!cmd) return;
        const { severity, reasons } = classifyHookCommand(cmd, integrity);
        findings.push({
          event,
          groupIndex: gi,
          hookIndex: hi,
          type: "command",
          command: cmd,
          severity,
          reasons,
        });
      });
    });
  }
  return findings;
}

/** Sentinel message used when the hooks block doesn't match the schema. */
export const HOOKS_SCHEMA_VALIDATION_FAILED = "hooks config failed schema validation";

export async function auditSettingsFile(path?: string, claudeDir?: string): Promise<AuditResult> {
  const settingsPath = path ?? join(CLAUDE_DIR, "settings.json");
  if (!existsSync(settingsPath)) {
    return { settingsPath, exists: false, totalHooks: 0, findings: [] };
  }

  // Use canonical readJsonOrNull for ENOENT-vs-parse distinction and
  // JsonParseError wrapping — the one settings.json reader that previously
  // bypassed this. Returns null on ENOENT (already guarded above) or bad JSON.
  const parsed = await readJsonOrNull(settingsPath).catch(() => null);
  if (parsed === null) {
    // Malformed JSON - return empty audit (this is not the file we're trying
    // to defend against; a broken file is its own problem).
    return { settingsPath, exists: true, totalHooks: 0, findings: [] };
  }

  // Validate the hooks block against the schema before walking it. A failure
  // doesn't stop the audit - we surface it as a SchemaFinding (unknown severity)
  // and then fall through to auditHooks (which degrades gracefully on malformed
  // input). Using `unknown` rather than `suspicious` because a schema mismatch
  // alone doesn't prove malice - it might be forward-compat drift from a newer
  // Claude Code version.
  const extraFindings: SchemaFinding[] = [];
  let validatedHooks: Record<string, unknown> | undefined;
  if (parsed !== null && typeof parsed === "object") {
    const hooksRaw = (parsed as Record<string, unknown>).hooks;
    if (hooksRaw !== undefined) {
      const schemaResult = HooksBlock.safeParse(hooksRaw);
      if (!schemaResult.success) {
        const issueSummary = schemaResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        extraFindings.push({
          event: "schema",
          groupIndex: -1,
          hookIndex: -1,
          type: "schema-validation",
          command: HOOKS_SCHEMA_VALIDATION_FAILED,
          severity: "unknown",
          reasons: [issueSummary],
        });
      } else {
        // §3.2: pass validated hooks data so auditHooks doesn't repeat defensive checks
        validatedHooks = schemaResult.data as Record<string, unknown>;
      }
    }
  }

  // Content verification against the install manifest - shipped-pattern
  // commands are only "trusted" when the file they point at hashes to what
  // setup.ts installed.
  const integrity = await loadSrcIntegrity(claudeDir);

  // §3.2: When schema validation passed, inject the validated hooks block so
  // auditHooks receives typed data and skips redundant typeof guards.
  const auditInput =
    validatedHooks !== undefined
      ? { ...(parsed as Record<string, unknown>), hooks: validatedHooks }
      : parsed;

  // totalHooks counts audited command hooks (the "hook command(s) total" the
  // CLI prints) - NOT findings, which also include the schema pseudo-finding.
  const hookFindings = auditHooks(auditInput, integrity);
  const findings: AuditFinding[] = [...extraFindings, ...hookFindings];
  return { settingsPath, exists: true, totalHooks: hookFindings.length, findings };
}

export function hasSuspicious(result: AuditResult): boolean {
  return result.findings.some((f) => f.severity === "suspicious");
}

export function hasUnknown(result: AuditResult): boolean {
  return result.findings.some((f) => f.severity === "unknown");
}

export function hasStale(result: AuditResult): boolean {
  return result.findings.some((f) => f.severity === "stale");
}

export function formatAuditReport(result: AuditResult): string {
  if (!result.exists) {
    return `No settings.json at ${result.settingsPath} — nothing to audit.`;
  }

  const lines: string[] = [];
  lines.push(`Audited ${result.settingsPath}`);
  lines.push(`  ${result.totalHooks} hook command(s) total.`);
  lines.push("");

  const grouped: Record<HookSeverity, AuditFinding[]> = {
    suspicious: [],
    stale: [],
    unknown: [],
    trusted: [],
  };
  for (const f of result.findings) grouped[f.severity].push(f);

  if (grouped.suspicious.length > 0) {
    lines.push(`✖ SUSPICIOUS (${grouped.suspicious.length}):`);
    for (const f of grouped.suspicious) {
      lines.push(`  [${f.event}] ${f.command}`);
      for (const r of f.reasons) lines.push(`    → ${r}`);
    }
    lines.push("");
  }

  if (grouped.stale.length > 0) {
    lines.push(`⚠ STALE (${grouped.stale.length}) — leftovers from cc-settings hook renames:`);
    for (const f of grouped.stale) {
      lines.push(`  [${f.event}] ${f.command}`);
    }
    lines.push(
      "  Stale entries are harmless but noisy. Re-run setup.sh to prune them and refresh the fingerprint.",
    );
    lines.push("");
  }

  if (grouped.unknown.length > 0) {
    lines.push(`⚠ UNKNOWN (${grouped.unknown.length}) — review manually:`);
    for (const f of grouped.unknown) {
      lines.push(`  [${f.event}] ${f.command}`);
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${grouped.trusted.length} trusted, ${grouped.stale.length} stale, ${grouped.unknown.length} unknown, ${grouped.suspicious.length} suspicious.`,
  );

  if (grouped.suspicious.length > 0) {
    lines.push("");
    lines.push("Suspicious findings indicate possible supply-chain compromise.");
    lines.push("Remediation:");
    lines.push("  1. Inspect each suspicious hook above — note its command and event.");
    lines.push("  2. Back up ~/.claude/settings.json.");
    lines.push("  3. Manually remove the malicious entries from the hooks block.");
    lines.push("  4. Re-run setup.sh from cc-settings to refresh the fingerprint.");
    lines.push("  5. Investigate which npm/pypi package introduced it.");
    lines.push("");
    lines.push("See SECURITY.md in the cc-settings repo for the full threat model.");
  }

  return lines.join("\n");
}
