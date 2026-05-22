// Supply-chain defense scanner. Reads ~/.claude/settings.json, walks every
// hook command across every event, classifies each as trusted/unknown/
// suspicious. Motivated by the Shai-Hulud npm worm (May 2026) which writes
// SessionStart hooks into settings.json that survive `npm uninstall` and
// re-execute on every Claude Code session.
//
// Classification rules:
//   trusted    — matches cc-settings' shipped command pattern
//                (`bun "$HOME/.claude/src/{scripts,hooks,lib}/<name>.ts"`)
//                or a recognized harmless built-in pattern.
//   suspicious — matches a high-confidence malware signature (curl|wget piping
//                to a shell, base64 decode + exec, eval, /tmp/ exec, node/python
//                -e or -c, long single-line opaque commands).
//   unknown    — neither. User-added custom hooks land here. They're not
//                inherently bad; they just haven't been vouched for.
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

export type Severity = "trusted" | "unknown" | "suspicious";

export interface HookFinding {
  event: string;
  groupIndex: number;
  hookIndex: number;
  type: string;
  command: string;
  severity: Severity;
  reasons: string[];
}

export interface AuditResult {
  settingsPath: string;
  exists: boolean;
  totalHooks: number;
  findings: HookFinding[];
}

// `bun "$HOME/.claude/src/<dir>/<name>.ts"` — accept quoted and unquoted
// `$HOME` and `${HOME}` forms. Allow an optional trailing arg list (some
// hooks invoke a script with positional args).
const TRUSTED_BUN_CC =
  /^bun\s+"?\$\{?HOME\}?\/\.claude\/src\/(scripts|hooks|lib)\/[a-zA-Z0-9_-]+\.ts"?(\s.*)?$/;

// Compound commands that chain multiple trusted bun scripts with `;` or `&&`.
// We check each sub-command against TRUSTED_BUN_CC.
function isTrustedCompound(cmd: string): boolean {
  const parts = cmd.split(/\s*(?:;|&&|\|\|)\s*/).filter((p) => p.length > 0);
  if (parts.length < 2) return false;
  return parts.every((p) => TRUSTED_BUN_CC.test(p));
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
  // No spaces in long runs → likely obfuscated/encoded
  const longestRun = Math.max(...cmd.split(/\s/).map((s) => s.length));
  if (longestRun > 200) return true;
  // High density of base64 alphabet → encoded payload
  const b64Chars = (cmd.match(/[A-Za-z0-9+/=]/g) ?? []).length;
  return b64Chars / cmd.length > 0.85;
}

export function classify(cmd: string): { severity: Severity; reasons: string[] } {
  const reasons: string[] = [];

  // Trust first.
  if (TRUSTED_BUN_CC.test(cmd)) {
    return { severity: "trusted", reasons: ["matches cc-settings shipped script pattern"] };
  }
  if (isTrustedCompound(cmd)) {
    return { severity: "trusted", reasons: ["chains multiple cc-settings shipped scripts"] };
  }

  // Then explicit suspicion.
  for (const { rx, reason } of SUSPICIOUS_PATTERNS) {
    if (rx.test(cmd)) reasons.push(reason);
  }
  if (looksOpaque(cmd)) reasons.push("long single-token blob (likely obfuscated payload)");

  if (reasons.length > 0) return { severity: "suspicious", reasons };

  return {
    severity: "unknown",
    reasons: ["does not match cc-settings shipped pattern — review manually"],
  };
}

// Settings.json shape we care about: top-level `hooks` is `{ [event]: HookGroup[] }`
// where each group has `hooks: Hook[]`. We tolerate unknown shapes silently
// (return empty findings) — a malformed settings.json is a different problem.

export function auditHooks(settings: unknown): HookFinding[] {
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
        const { severity, reasons } = classify(cmd);
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

export async function auditSettingsFile(path?: string): Promise<AuditResult> {
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

  const findings = [...extraFindings, ...auditHooks(parsed)];
  return { settingsPath, exists: true, totalHooks: findings.length, findings };
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

  const grouped: Record<Severity, HookFinding[]> = {
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
