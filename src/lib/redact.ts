// Canonical secret redaction — the single place that decides what a
// possibly-untrusted command string or subprocess-output string must never
// leak in plaintext, before it's logged, cached to disk, or echoed to a
// terminal/statusline.
//
// Before this module, the same job was duplicated (and diverged) in two
// places: src/hooks/safety-net.ts's local `redactSecrets` (7 patterns:
// sk-, ghp_, AKIA, Bearer, password=/token=/secret=) and src/lib/codex.ts's
// `sanitizeOutput` (4 patterns: sk-, Bearer, Authorization:, *_API_KEY/
// TOKEN/SECRET=). log-bash.ts — the HIGHER-exposure surface, since it logs
// every Bash command, not just blocked ones — inherited the weaker of the
// two. See M23 in docs/audits/codebase-audit-2026-07-08.md.
//
// This is the union of both pattern sets, plus: fine-grained GitHub PATs
// (`github_pat_...`, GitHub's newer token format alongside the classic
// `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` prefixes already covered).
//
// Ordering is load-bearing:
//
// - `sk-` runs FIRST so a value like `OPENAI_API_KEY=sk-...` gets its `sk-`
//   suffix collapsed before the generic `=`-pattern (below) swallows the
//   whole thing into one clean `OPENAI_API_KEY=[redacted]`, rather than
//   leaving a nested `OPENAI_API_KEY=sk-[redacted]` fragment.
// - The tight, `[^ &"]+`-bounded `password=`/`token=`/`secret=` patterns run
//   BEFORE the broad, case-insensitive `*_API_KEY|TOKEN|SECRET=` pattern.
//   The broad pattern's value-capture also stops at `&`/`"` (not just
//   whitespace) for the same reason: a query string like
//   `?token=abc&foo=bar` must only lose the token's value, not swallow the
//   unrelated `foo=bar` alongside it — which a `\S+` capture would do since
//   it doesn't stop at `&`.
//   `token=`/`secret=` are deliberately case-SENSITIVE (lowercase only): the
//   broad pattern already covers uppercase `TOKEN=`/`SECRET=` env-var forms
//   case-insensitively, so a case-insensitive tight pattern here would
//   re-match and mangle text the broad pattern already redacted correctly
//   (e.g. `MY_TOKEN=[redacted]` would become `MY_token=[REDACTED]`).
//   `password=` has no such collision (PASSWORD isn't in the broad
//   pattern's alternation) so it stays case-insensitive for wider coverage.
//
// Do not reorder without re-checking tests/redact.test.ts and
// tests/codex.test.ts's sanitizeOutput cases.
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-[redacted]")
    .replace(/gh[posur]_[A-Za-z0-9]{10,}/g, "[redacted]") // classic GitHub PAT prefixes
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]") // fine-grained GitHub PAT
    .replace(/AKIA[A-Z0-9]{12,}/g, "[redacted]") // AWS access key ID
    .replace(/Bearer[\s:]+\S+/gi, "Bearer [redacted]")
    .replace(/(Authorization:\s*)\S+/gi, "$1[redacted]")
    .replace(/password=[^ &"]+/gi, "password=[redacted]")
    .replace(/token=[^ &"]+/g, "token=[redacted]")
    .replace(/secret=[^ &"]+/g, "secret=[redacted]")
    .replace(/\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET))=[^\s&"]+/gi, "$1=[redacted]");
}
