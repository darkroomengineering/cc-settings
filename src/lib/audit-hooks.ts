// Supply-chain defense scanner. Reads ~/.claude/settings.json, walks every
// hook command across every event, classifies each as trusted/unknown/
// suspicious. Motivated by the Shai-Hulud npm worm (May 2026) which writes
// SessionStart hooks into settings.json that survive `npm uninstall` and
// re-execute on every Claude Code session.
//
// Classification rules:
//   trusted    — matches cc-settings' shipped command pattern
//                (`bun "$HOME/.claude/src/{scripts,hooks,lib}/<name>.ts"`)
//                AND the referenced file's content hash matches the install
//                manifest written by setup.ts. Trust is content-based, not
//                path-based: a path-shaped match alone proves nothing, since
//                malware can drop ~/.claude/src/hooks/evil.ts or patch a
//                shipped script in place (see SECURITY.md).
//   suspicious — matches a high-confidence malware signature (curl|wget piping
//                to a shell, base64 decode + exec, eval, /tmp/ exec, node/python
//                -e or -c, long single-line opaque commands), OR is path-shaped
//                but fails content verification against the install manifest.
//   unknown    — neither. User-added custom hooks land here, as do shipped-
//                pattern commands when no install manifest exists (pre-manifest
//                install). They're not inherently bad; they just haven't been
//                vouched for.
//
// Exit code policy (CLI):
//   suspicious findings → exit 1
//   only unknown findings → exit 0, but surface for review
//   nothing found → exit 0

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Hook, HookGroup } from "../schemas/hooks.ts";
import { HooksBlock } from "../schemas/hooks.ts";
import { hashFileOrNull, readSrcManifest } from "./hooks-fingerprint.ts";

export type HookSeverity = "trusted" | "unknown" | "suspicious";

export interface HookFinding {
  event: string;
  groupIndex: number;
  hookIndex: number;
  type: string;
  command: string;
  severity: HookSeverity;
  reasons: string[];
}

export interface AuditResult {
  settingsPath: string;
  exists: boolean;
  totalHooks: number;
  findings: HookFinding[];
}

/** Content-integrity view consumed by the classifier: rel path under
 *  ~/.claude/src → does the on-disk content hash match the install manifest?
 *  `null`/absent means no manifest exists — classification degrades to
 *  "unknown" for shipped-pattern commands rather than trusting path shape. */
export interface SrcIntegrity {
  files: Map<string, boolean>;
}

/** Build the SrcIntegrity view: every manifested file, hashed on disk and
 *  compared. Returns null when no manifest exists (pre-manifest install) or
 *  on any read error — fail-soft, never throws. */
export async function loadSrcIntegrity(claudeDir?: string): Promise<SrcIntegrity | null> {
  try {
    const dir = claudeDir ?? join(homedir(), ".claude");
    const manifest = await readSrcManifest(dir);
    if (!manifest) return null;
    const files = new Map<string, boolean>();
    for (const [rel, expected] of Object.entries(manifest.files)) {
      files.set(rel, (await hashFileOrNull(join(dir, "src", rel))) === expected);
    }
    return { files };
  } catch {
    return null;
  }
}

// `bun "$HOME/.claude/src/<dir>/<name>.ts"` — accept quoted and unquoted
// `$HOME` and `${HOME}` forms. Allow an optional trailing arg list (some
// hooks invoke a script with positional args). Capture group 1 is the path
// relative to ~/.claude/src — the install-manifest key.
const TRUSTED_BUN_CC =
  /^bun\s+"?\$\{?HOME\}?\/\.claude\/src\/((?:scripts|hooks|lib)\/[a-zA-Z0-9_-]+\.ts)"?(\s.*)?$/;

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

// Compound commands that chain multiple trusted bun scripts with `;` or `&&`.
// Each sub-command must match TRUSTED_BUN_CC *and* pass content verification;
// the compound's severity is the worst of its parts.
function classifyCompound(
  cmd: string,
  integrity: SrcIntegrity | null | undefined,
): { severity: HookSeverity; reasons: string[] } | null {
  const parts = cmd.split(/\s*(?:;|&&|\|\|)\s*/).filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const matches = parts.map((p) => p.match(TRUSTED_BUN_CC));
  if (!matches.every((m) => m?.[1])) return null;

  const results = matches.map((m) => classifyShippedPath(m?.[1] ?? "", integrity));
  const suspicious = results.filter((r) => r.severity === "suspicious");
  if (suspicious.length > 0) {
    return { severity: "suspicious", reasons: suspicious.flatMap((r) => r.reasons) };
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
  // No spaces in long runs → likely obfuscated/encoded. reduce (not spread)
  // because `cmd` is arbitrary settings.json text — a pathological token count
  // would blow the call stack with Math.max(...tokens).
  const longestRun = cmd.split(/\s/).reduce((m, s) => Math.max(m, s.length), 0);
  if (longestRun > 200) return true;
  // High density of base64 alphabet → encoded payload
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
  // Shipped-pattern commands first. Trust is CONTENT-based (install manifest),
  // not path-based. When there's no manifest we can't promote to "trusted" —
  // but a malware-signature hit in the command still wins over "unknown".
  const m = cmd.match(TRUSTED_BUN_CC);
  if (m?.[1]) {
    const result = classifyShippedPath(m[1], integrity);
    if (result.severity === "unknown") {
      const sus = matchSuspicious(cmd);
      if (sus.length > 0) return { severity: "suspicious", reasons: sus };
    }
    return result;
  }
  const compound = classifyCompound(cmd, integrity);
  if (compound) return compound;

  // Then explicit suspicion.
  const reasons = matchSuspicious(cmd);
  if (reasons.length > 0) return { severity: "suspicious", reasons };

  return {
    severity: "unknown",
    reasons: ["does not match cc-settings shipped pattern — review manually"],
  };
}

// Settings.json shape we care about: top-level `hooks` is `{ [event]: HookGroup[] }`
// where each group has `hooks: Hook[]`. We tolerate unknown shapes silently
// (return empty findings) — a malformed settings.json is a different problem.

export function auditHooks(settings: unknown, integrity?: SrcIntegrity | null): HookFinding[] {
  if (!settings || typeof settings !== "object") return [];
  const hooks = (settings as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object") return [];

  const findings: HookFinding[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group: unknown, gi: number) => {
      if (!group || typeof group !== "object") return;
      const entries = (group as HookGroup).hooks;
      if (!Array.isArray(entries)) return;
      entries.forEach((entry: Hook, hi: number) => {
        // Only `command`-type hooks have a string command. Prompt/agent/http/
        // mcp_tool hooks don't run arbitrary shell, so out of scope here.
        if (entry?.type !== "command") return;
        const cmd = entry.command.trim();
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
  const settingsPath = path ?? join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { settingsPath, exists: false, totalHooks: 0, findings: [] };
  }
  let parsed: unknown = null;
  try {
    const text = await readFile(settingsPath, "utf8");
    parsed = JSON.parse(text);
  } catch {
    // Malformed JSON — return empty audit (this is not the file we're trying
    // to defend against; a broken file is its own problem).
    return { settingsPath, exists: true, totalHooks: 0, findings: [] };
  }

  // Validate the hooks block against the schema before walking it. A failure
  // doesn't stop the audit — we surface it as an `unknown` finding and then
  // fall through to auditHooks (which degrades gracefully on malformed input).
  // Using `unknown` rather than `suspicious` because a schema mismatch alone
  // doesn't prove malice — it might be forward-compat drift from a newer
  // Claude Code version.
  const extraFindings: HookFinding[] = [];
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
      }
    }
  }

  // Content verification against the install manifest — shipped-pattern
  // commands are only "trusted" when the file they point at hashes to what
  // setup.ts installed.
  const integrity = await loadSrcIntegrity(claudeDir);

  // totalHooks counts audited command hooks (the "hook command(s) total" the
  // CLI prints) — NOT findings, which also include the schema pseudo-finding.
  const hookFindings = auditHooks(parsed, integrity);
  const findings = [...extraFindings, ...hookFindings];
  return { settingsPath, exists: true, totalHooks: hookFindings.length, findings };
}

export function hasSuspicious(result: AuditResult): boolean {
  return result.findings.some((f) => f.severity === "suspicious");
}

export function hasUnknown(result: AuditResult): boolean {
  return result.findings.some((f) => f.severity === "unknown");
}

export function formatAuditReport(result: AuditResult): string {
  if (!result.exists) {
    return `No settings.json at ${result.settingsPath} — nothing to audit.`;
  }

  const lines: string[] = [];
  lines.push(`Audited ${result.settingsPath}`);
  lines.push(`  ${result.totalHooks} hook command(s) total.`);
  lines.push("");

  const grouped: Record<HookSeverity, HookFinding[]> = {
    suspicious: [],
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

  if (grouped.unknown.length > 0) {
    lines.push(`⚠ UNKNOWN (${grouped.unknown.length}) — review manually:`);
    for (const f of grouped.unknown) {
      lines.push(`  [${f.event}] ${f.command}`);
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${grouped.trusted.length} trusted, ${grouped.unknown.length} unknown, ${grouped.suspicious.length} suspicious.`,
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
