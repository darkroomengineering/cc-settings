// Dry-run classifier for cc-settings' composed Bash permission rules.
//
// Steals the self-testing/dry-run pattern from openai/codex's execpolicy:
// Starlark `prefix_rule()` rules there carry match/not_match example
// commands validated at rule-load time, and `codex execpolicy check --rules
// <file> -- <command...>` classifies a command against the rule set without
// actually running it. This module is the cc-settings analog for our own
// Bash permission rules — `bun run permissions:check "<cmd>"` classifies a
// command the same way Claude Code's permission prompt would, without
// invoking Claude Code.
//
// Matching semantics (v1, Bash rules only — Claude Code's actual rule shapes
// observed in config/30-permissions.json):
//   - `Bash(exact cmd)`             — exact match
//   - `Bash(prefix *)` / `Bash(prefix:*)` — boundary-aware prefix match: the
//     command must equal the prefix or start with "<prefix> ". The `:`/` `
//     before the trailing `*` is Claude Code's syntax marker, not a literal
//     character — it does NOT appear in the command being matched.
//   - `*` anywhere else in the pattern is a general glob wildcard (matches
//     any run of characters), e.g. `Bash(gh api * -X DELETE:*)` — observed
//     in config/30-permissions.json's deny list.
//   - `Bash(*)` (bare wildcard pattern) matches every command.
//   - bare `Bash` (no parens at all) — matches every Bash command.
//
// Decision precedence (deny -> ask -> allow, matching Claude Code's actual
// permission-prompt precedence — an explicit ask rule beats a broader allow
// rule, not just deny): any deny match -> deny; else any ask match -> ask;
// else any allow match -> allow; else -> ask (default, no rule matched at
// all). When a compound command's segments disagree, the STRICTEST decision
// wins across segments — this mirrors execpolicy's `forbidden > prompt >
// allow` ordering (here: deny > ask > allow). A single dangerous segment in
// an otherwise-safe chain must not be laundered by its neighbors.
//
// Compound splitting: `&&`, `||`, `;`, `|` split a command into segments,
// each evaluated independently. Commands containing redirection (`<`, `>`),
// command substitution (`$(`), backticks, a single background `&` (not part
// of `&&`), or an embedded newline are NOT split — shell semantics there are
// ambiguous enough that a naive split could misclassify a dangerous command
// as a sequence of benign-looking segments, so the whole string is evaluated
// as one opaque unit instead.
//
// Opaque commands can NEVER resolve to "allow". A real review finding: `git
// status > /tmp/s && rm -rf ~` is opaque (contains `>`), and naively
// evaluating the whole string against an allow prefix rule like
// `Bash(git status:*)` would launder the trailing `&& rm -rf ~` through an
// allow decision — the prefix match says nothing about what comes after the
// redirection. So for an opaque command: a deny match on the whole string ->
// deny; otherwise -> ask, regardless of any allow match. Fail-closed, same
// spirit as execpolicy's tree-sitter policy refusing to decompose an
// unparseable command tree.
//
// Opaque commands are ALSO naively fragmented (on `&&`/`||`/`;`/`|`/a lone
// `&`/newlines) purely to rescan for deny matches — `echo hi\nrm -rf ~` is
// opaque (embedded newline) and the whole string won't literally equal a
// deny rule, but the `rm -rf ~` fragment will. Any fragment deny hit
// escalates the opaque result from ask to deny (never a downgrade, and
// allow stays impossible either way). This fragment split is deliberately
// quote-blind — see `classifyOpaqueSegment`'s doc comment for why that's an
// acceptable, fail-closed limitation (it can only make things stricter).

export type Decision = "allow" | "deny" | "ask";

export interface RuleSet {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface SegmentResult {
  segment: string;
  decision: Decision;
  /** Rules (from allow/deny/ask) that matched this segment. Empty when the
   *  decision is "ask" by default (no explicit ask-list rule matched, or the
   *  segment was opaque and only deny/ask rules were even considered). */
  matchedRules: string[];
}

export interface PermissionCheckResult {
  command: string;
  decision: Decision;
  /** True when the command contains redirection/substitution/backticks/a
   *  background `&`/an embedded newline and was evaluated as a single
   *  opaque unit instead of being split on shell operators. An opaque
   *  result's decision is never "allow" — see module doc. */
  opaque: boolean;
  segments: SegmentResult[];
}

// Redirection (`<`/`>`), command substitution (`$(`), backticks, a bare
// newline/CR, or a single background `&` (NOT part of `&&`, which is a
// compound-command operator handled by SEGMENT_SEP_RE below) — a command
// containing any of these is evaluated as one opaque unit. The `&`
// lookaround excludes `&&` specifically: neither `&` in a doubled pair is
// "not preceded/followed by `&`", so `a && b` stays splittable while `a & b`
// (backgrounding) does not.
const OPAQUE_RE = /`|\$\(|[<>]|\r|\n|(?<!&)&(?!&)/;

// Compound-command segment separator. `||` and `&&` are listed before the
// single-character `|` and `;` alternatives they contain, so the alternation
// consumes the two-char operators whole rather than splitting them in half.
const SEGMENT_SEP_RE = /\s*(?:\|\||&&|;|\|)\s*/;

// Broader separator used ONLY to naively fragment an already-opaque command
// for the deny-only rescan below — includes everything SEGMENT_SEP_RE does,
// plus the single background `&` and newlines/CR that make a command opaque
// in the first place. Order matters: `&&` before `&` so the alternation
// consumes the doubled operator whole.
const NAIVE_FRAGMENT_SEP_RE = /\s*(?:\|\||&&|;|\||&|\r?\n|\r)\s*/;

/** True iff `command` contains redirection/substitution/backticks/a
 *  background `&`/an embedded newline and must be evaluated as a single
 *  opaque unit (see module doc). */
export function isOpaqueCommand(command: string): boolean {
  return OPAQUE_RE.test(command);
}

/** Split a command on `&&`, `||`, `;`, `|` into trimmed, non-empty segments.
 *  Callers MUST check `isOpaqueCommand` first — this function does not
 *  itself guard against redirection/substitution/backticks/backgrounding. */
export function splitSegments(command: string): string[] {
  return command
    .split(SEGMENT_SEP_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface ParsedRule {
  tool: string;
  /** null for a bare tool rule with no parens (e.g. "Bash") — matches every
   *  command for that tool. */
  pattern: string | null;
}

/** Parse a permission rule string like `Bash(git push:*)` or bare `Bash`. */
function parseRule(rule: string): ParsedRule {
  const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\((.*)\))?$/s.exec(rule);
  if (!m?.[1]) return { tool: rule, pattern: null };
  return { tool: m[1], pattern: m[2] ?? null };
}

/** Escape regex metacharacters in a literal glob fragment (a piece of the
 *  pattern between `*` wildcards). */
function escapeRegexLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the match regex for a rule's parenthesized pattern.
 *
 *  A trailing `:*` or ` *` is Claude Code's boundary-aware "prefix, then
 *  optionally anything after a separator" marker — stripped off and handled
 *  as an exact-OR-"prefix "-then-anything alternation, never as a literal
 *  colon/space. Any other `*` (including a bare `*` pattern) is a general
 *  glob wildcard converted to `.*`. The `s` flag makes `.` (inside the `.*`
 *  we insert) match across embedded newlines too, so a payload can't dodge
 *  a mid-pattern wildcard by smuggling a newline through it.
 *
 *  Real rules like `Bash(curl * -d :*)` (config/30-permissions.json — also
 *  the `-F `/`-T ` variants) put a literal space right before the `:*`
 *  marker, so after stripping `:*` the stripped core ALREADY ends in the
 *  separator space (e.g. "curl * -d "). Appending another mandatory " "
 *  there would require a double space no real command has — `curl x -d foo`
 *  would never match `Bash(curl * -d :*)`. When the core already ends in
 *  whitespace, `.*` alone (which matches zero or more chars) covers both the
 *  bare-prefix and prefix+anything cases without an extra separator. */
function patternToRegex(pattern: string): RegExp {
  let core = pattern;
  let prefixWildcard = false;
  if (core.endsWith(":*") || core.endsWith(" *")) {
    core = core.slice(0, -2);
    prefixWildcard = true;
  }
  const glob = core.split("*").map(escapeRegexLiteral).join(".*");
  let src: string;
  if (!prefixWildcard) {
    src = `^${glob}$`;
  } else if (/\s$/.test(core)) {
    src = `^${glob}.*$`;
  } else {
    src = `^(?:${glob}|${glob} .*)$`;
  }
  return new RegExp(src, "s");
}

/** Does a single Bash permission rule match `cmd`? Non-Bash rules never
 *  match (v1 is Bash-only — see module doc). */
export function bashRuleMatches(rule: string, cmd: string): boolean {
  const { tool, pattern } = parseRule(rule);
  if (tool !== "Bash") return false;
  if (pattern === null) return true; // bare `Bash` — matches everything
  return patternToRegex(pattern).test(cmd);
}

const STRICTNESS: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

/** Strictest decision across a set — deny > ask > allow (execpolicy's
 *  forbidden > prompt > allow ordering, renamed to our three decisions). */
export function strictestDecision(decisions: Decision[]): Decision {
  return decisions.reduce<Decision>(
    (acc, d) => (STRICTNESS[d] > STRICTNESS[acc] ? d : acc),
    "allow",
  );
}

/** Classify a single (non-compound) command segment against a rule set.
 *
 *  Precedence: deny, then ask, then allow (matches Claude Code's actual
 *  permission-prompt precedence — an explicit ask rule beats a broader
 *  allow rule). When `opaque` is true, the allow check is skipped entirely:
 *  an opaque segment (redirection/substitution/backticks/backgrounding/
 *  embedded newline) can resolve to "deny" or the default "ask", but never
 *  "allow" — see module doc. */
export function classifySegment(segment: string, rules: RuleSet, opaque = false): SegmentResult {
  const cmd = segment.trim();

  const denyMatches = rules.deny.filter((r) => bashRuleMatches(r, cmd));
  if (denyMatches.length > 0) return { segment: cmd, decision: "deny", matchedRules: denyMatches };

  const askMatches = rules.ask.filter((r) => bashRuleMatches(r, cmd));
  if (askMatches.length > 0) return { segment: cmd, decision: "ask", matchedRules: askMatches };

  if (!opaque) {
    const allowMatches = rules.allow.filter((r) => bashRuleMatches(r, cmd));
    if (allowMatches.length > 0) {
      return { segment: cmd, decision: "allow", matchedRules: allowMatches };
    }
  }

  // No deny/ask match, and either no allow match or allow was skipped
  // (opaque) — default decision is "ask" (would prompt).
  return { segment: cmd, decision: "ask", matchedRules: [] };
}

/** Classify an opaque command (see module doc). The whole string is checked
 *  first via `classifySegment(..., true)` (deny/ask only, allow suppressed).
 *  If that alone doesn't already resolve to deny, the string is ALSO
 *  naively fragmented on every operator that can separate shell commands
 *  (`&&`, `||`, `;`, `|`, a lone `&`, and newlines/CR) and each fragment is
 *  checked ONLY against deny rules — a fragment hit upgrades ask -> deny,
 *  and never downgrades an existing deny, and can never produce allow.
 *
 *  Known limitation: this naive split is quote-blind — it has no idea
 *  `echo "safe | text"` has its `|` inside a string literal, and will
 *  happily produce a bogus `echo "safe` / `text"` fragment split. That is
 *  intentional and safe: fragments are used ONLY to escalate to deny, never
 *  to grant allow, so an incorrect split can only make the result stricter
 *  (ask/deny), never launder something through as allow. */
function classifyOpaqueSegment(cmd: string, rules: RuleSet): SegmentResult {
  const whole = classifySegment(cmd, rules, true);
  if (whole.decision === "deny") return whole;

  const fragments = cmd
    .split(NAIVE_FRAGMENT_SEP_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const fragmentDenyMatches = new Set<string>();
  for (const fragment of fragments) {
    for (const r of rules.deny) {
      if (bashRuleMatches(r, fragment)) fragmentDenyMatches.add(r);
    }
  }
  if (fragmentDenyMatches.size === 0) return whole;

  return {
    segment: cmd,
    decision: "deny",
    matchedRules: Array.from(new Set([...whole.matchedRules, ...fragmentDenyMatches])),
  };
}

/** Classify a full command (single or compound) against a Bash rule set. */
export function classifyCommand(command: string, rules: RuleSet): PermissionCheckResult {
  const trimmed = command.trim();

  if (isOpaqueCommand(trimmed)) {
    const seg = classifyOpaqueSegment(trimmed, rules);
    return { command: trimmed, decision: seg.decision, opaque: true, segments: [seg] };
  }

  const rawSegments = splitSegments(trimmed);
  if (rawSegments.length <= 1) {
    const seg = classifySegment(trimmed, rules);
    return { command: trimmed, decision: seg.decision, opaque: false, segments: [seg] };
  }

  const segments = rawSegments.map((s) => classifySegment(s, rules));
  const decision = strictestDecision(segments.map((s) => s.decision));
  return { command: trimmed, decision, opaque: false, segments };
}

/** Pull the Bash-relevant allow/deny/ask arrays out of a composed or
 *  installed settings object's `permissions` value. Tolerant of missing
 *  keys/malformed shapes — returns empty arrays rather than throwing. */
export function extractBashRuleSet(permissions: unknown): RuleSet {
  const p =
    permissions && typeof permissions === "object" ? (permissions as Record<string, unknown>) : {};
  const pick = (key: string): string[] => {
    const v = p[key];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };
  return { allow: pick("allow"), deny: pick("deny"), ask: pick("ask") };
}

const DECISION_LABEL: Record<Decision, string> = {
  deny: "DENY (blocked)",
  ask: "ASK (would prompt)",
  allow: "ALLOW (allowed)",
};

/** Human-readable report for a classification result. */
export function formatResult(result: PermissionCheckResult): string {
  const lines: string[] = [`Command: ${result.command}`];

  if (result.opaque) {
    lines.push(
      "Opaque command (contains redirection, command substitution, backticks, a background `&`, or an embedded newline) — evaluated as one unit, not split on shell operators. Opaque commands never resolve to ALLOW: only deny rules are checked; otherwise the decision defaults to ASK.",
    );
  } else if (result.segments.length > 1) {
    lines.push(`Compound command — split into ${result.segments.length} segment(s):`);
  }

  if (result.segments.length > 1) {
    for (const seg of result.segments) {
      const matched =
        seg.matchedRules.length > 0 ? ` — matched: ${seg.matchedRules.join(", ")}` : "";
      lines.push(`  [${seg.decision}] ${seg.segment}${matched}`);
    }
  } else {
    const seg = result.segments[0];
    if (seg && seg.matchedRules.length > 0) {
      lines.push(`Matched rule(s): ${seg.matchedRules.join(", ")}`);
    }
  }

  lines.push(`Decision: ${DECISION_LABEL[result.decision]}`);
  return lines.join("\n");
}
