// Unit tests for pure exported functions in src/lib/codex.ts.
// No filesystem I/O, no subprocess spawning — pure logic only.

import { describe, expect, test } from "bun:test";
import {
  buildReviewPrompt,
  type CodexVerdict,
  classifyCodexError,
  parseReviewArgs,
  reconcile,
  sanitizeOutput,
} from "../src/lib/codex.ts";

// ---------------------------------------------------------------------------
// classifyCodexError — state classification
// ---------------------------------------------------------------------------

describe("classifyCodexError — rate-limited classification", () => {
  test("'quota exceeded' stderr maps to rate-limited, not no-access", () => {
    // Business rule: Codex's quota message is also emitted on auth/workspace
    // mismatch, so we classify it as transient (rate-limited) to surface a
    // re-login hint rather than concluding the account has no plan.
    const { state } = classifyCodexError(1, "Error: quota exceeded for this account");
    expect(state).toBe("rate-limited");
  });

  test("'usage limit' in stderr → rate-limited", () => {
    const { state } = classifyCodexError(1, "You have hit your usage limit for today");
    expect(state).toBe("rate-limited");
  });

  test("'rate limit' in stderr → rate-limited", () => {
    const { state } = classifyCodexError(1, "rate limit reached, slow down requests");
    expect(state).toBe("rate-limited");
  });

  test("'rate-limit' (hyphenated) in stderr → rate-limited", () => {
    const { state } = classifyCodexError(1, "rate-limit exceeded");
    expect(state).toBe("rate-limited");
  });

  test("'too many requests' in stderr → rate-limited", () => {
    const { state } = classifyCodexError(1, "Too many requests sent to the server");
    expect(state).toBe("rate-limited");
  });

  test("HTTP 429 code in stderr → rate-limited", () => {
    const { state } = classifyCodexError(429, "HTTP 429 Too Many Requests");
    expect(state).toBe("rate-limited");
  });

  test("matching is case-insensitive (QUOTA EXCEEDED → rate-limited)", () => {
    const { state } = classifyCodexError(1, "QUOTA EXCEEDED");
    expect(state).toBe("rate-limited");
  });
});

describe("classifyCodexError — no-access classification", () => {
  test("'unauthorized' in stderr → no-access", () => {
    const { state } = classifyCodexError(1, "unauthorized: invalid credentials");
    expect(state).toBe("no-access");
  });

  test("'401' in stderr → no-access", () => {
    const { state } = classifyCodexError(401, "HTTP 401 Unauthorized");
    expect(state).toBe("no-access");
  });

  test("'forbidden' in stderr → no-access", () => {
    const { state } = classifyCodexError(1, "forbidden: this resource is restricted");
    expect(state).toBe("no-access");
  });

  test("'403' in stderr → no-access", () => {
    const { state } = classifyCodexError(403, "HTTP 403 Forbidden");
    expect(state).toBe("no-access");
  });

  test("'no access' in stderr → no-access", () => {
    const { state } = classifyCodexError(1, "no access to this workspace");
    expect(state).toBe("no-access");
  });

  test("'not entitled' in stderr → no-access", () => {
    const { state } = classifyCodexError(1, "user is not entitled to use Codex");
    expect(state).toBe("no-access");
  });

  test("'does not have access' in stderr → no-access", () => {
    const { state } = classifyCodexError(1, "This account does not have access to Codex");
    expect(state).toBe("no-access");
  });

  test("matching is case-insensitive (UNAUTHORIZED → no-access)", () => {
    const { state } = classifyCodexError(1, "UNAUTHORIZED");
    expect(state).toBe("no-access");
  });
});

describe("classifyCodexError — unknown fallback", () => {
  test("unrecognized stderr → unknown", () => {
    const { state } = classifyCodexError(1, "some unexpected error from codex");
    expect(state).toBe("unknown");
  });

  test("empty stderr with non-zero exit → unknown with 'exit <code>' detail", () => {
    // When stderr is empty the detail must fall back to 'exit <code>' so the
    // caller always has something actionable to show.
    const { state, detail } = classifyCodexError(2, "");
    expect(state).toBe("unknown");
    expect(detail).toBe("exit 2");
  });

  test("whitespace-only stderr → detail falls back to 'exit <code>'", () => {
    const { state, detail } = classifyCodexError(3, "   \n  \t  ");
    expect(state).toBe("unknown");
    expect(detail).toBe("exit 3");
  });
});

// ---------------------------------------------------------------------------
// classifyCodexError — sanitization (security guarantee)
// These tests assert that the returned `detail` never contains raw secrets,
// ANSI escapes, or oversized content from the subprocess stderr.
// ---------------------------------------------------------------------------

describe("classifyCodexError — detail sanitization", () => {
  test("ANSI escape sequence is stripped from detail", () => {
    // The ANSI regex is built from charCode(27) to avoid biome's lint rule —
    // construct the sequence the same way here.
    const ESC = String.fromCharCode(27);
    const stderr = `${ESC}[31msome codex error${ESC}[0m`;
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).not.toContain(ESC);
    expect(detail).toContain("some codex error");
  });

  test("sk-XXXX token (16+ chars) is redacted to sk-[redacted]", () => {
    // A leaked API key in subprocess output must never reach the verdict file
    // or the statusline.
    // Standalone token (not after "Bearer", which would subsume it under the
    // Bearer rule and emit "Bearer [redacted]" instead — also a valid redaction).
    const token = "sk-ABCDEFGHIJKLMNOPabcdefghijklmnop";
    const stderr = `error: leaked credential ${token} in output`;
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).not.toContain(token);
    expect(detail).toContain("sk-[redacted]");
  });

  test("sk- token shorter than 16 chars is NOT redacted", () => {
    // The regex requires 16+ chars after 'sk-' — short tokens must not be
    // mangled, so the redaction is specific rather than over-broad.
    const stderr = `error: sk-short (small) context`;
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).toContain("sk-short");
  });

  test("'Bearer <token>' is redacted to 'Bearer [redacted]'", () => {
    const stderr = "unauthorized: Authorization header Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig";
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(detail).toContain("Bearer [redacted]");
  });

  test("'Authorization: <value>' is redacted to 'Authorization: [redacted]'", () => {
    const stderr = "Authorization: token_secret_value_here";
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).not.toContain("token_secret_value_here");
    expect(detail).toContain("Authorization: [redacted]");
  });

  test("detail is capped at 200 characters", () => {
    // A subprocess could emit a very long stderr line; the cap prevents the
    // verdict file and statusline from being polluted with a multi-KB blob.
    const longStderr = `some codex error: ${"x".repeat(300)}`;
    const { detail } = classifyCodexError(1, longStderr);
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  test("first non-empty line is used (multiline stderr)", () => {
    // Only the first meaningful line should appear in detail — subsequent lines
    // might contain raw keys or stack traces.
    const stderr = "\n\nfirst real line\nsecond line with sk-SECRETSECRETSECRETSECRET";
    const { detail } = classifyCodexError(1, stderr);
    expect(detail).toBe("first real line");
  });
});

// ---------------------------------------------------------------------------
// reconcile — merging a cheap live check with the cached verdict
// ---------------------------------------------------------------------------

describe("reconcile — live 'not-installed' always wins", () => {
  test("live not-installed + cached no-access (sticky, fresh) → not-installed", () => {
    // A worse live state must override any cached sticky negative — if the
    // binary was removed, the no-access cache is irrelevant.
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("not-installed", cached);
    expect(result.state).toBe("not-installed");
    expect(result.sticky).toBe(false);
  });

  test("live not-installed + cached available → not-installed", () => {
    const cached: CodexVerdict = {
      state: "available",
      checkedAt: new Date().toISOString(),
      sticky: false,
    };
    const result = reconcile("not-installed", cached);
    expect(result.state).toBe("not-installed");
    expect(result.sticky).toBe(false);
  });

  test("live not-installed + cached rate-limited (sticky, fresh) → not-installed", () => {
    const cached: CodexVerdict = {
      state: "rate-limited",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("not-installed", cached);
    expect(result.state).toBe("not-installed");
    expect(result.sticky).toBe(false);
  });
});

describe("reconcile — live 'unauthenticated' always wins", () => {
  test("live unauthenticated + cached no-access (sticky, fresh) → unauthenticated", () => {
    // Like not-installed: a worse live state must always win because the sticky
    // cache can't express 'the user just logged out'.
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("unauthenticated", cached);
    expect(result.state).toBe("unauthenticated");
    expect(result.sticky).toBe(false);
  });

  test("live unauthenticated + cached rate-limited (sticky, fresh) → unauthenticated", () => {
    const cached: CodexVerdict = {
      state: "rate-limited",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("unauthenticated", cached);
    expect(result.state).toBe("unauthenticated");
    expect(result.sticky).toBe(false);
  });
});

describe("reconcile — live 'available' + fresh sticky negatives are kept", () => {
  test("live available + fresh sticky no-access → cached verdict returned unchanged", () => {
    // The cheap login-status check cannot see entitlement; a fresh sticky
    // no-access from a real exec must not be silently overwritten with
    // 'available'. The cached object is returned as-is.
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date().toISOString(),
      sticky: true,
      detail: "forbidden: no plan",
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("no-access");
    expect(result.sticky).toBe(true);
    expect(result).toBe(cached); // identity: same object, not a copy
  });

  test("live available + fresh sticky rate-limited → cached verdict returned unchanged", () => {
    // Quota isn't visible to login-status either; a recent rate-limited sticky
    // must be honored until its TTL (~5 hours).
    const cached: CodexVerdict = {
      state: "rate-limited",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("rate-limited");
    expect(result.sticky).toBe(true);
    expect(result).toBe(cached);
  });
});

describe("reconcile — live 'available' + stale sticky negatives expire", () => {
  // A 1970-01-01 timestamp is safely beyond both TTLs:
  //   no-access  24h TTL
  //   rate-limit ~5h TTL
  const staleTimestamp = new Date(0).toISOString();

  test("live available + stale no-access sticky → returns available", () => {
    // Once the TTL has passed, re-check is needed; return 'available' so the
    // next real exec re-probes entitlement.
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: staleTimestamp,
      sticky: true,
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("available");
    expect(result.sticky).toBe(false);
  });

  test("live available + stale rate-limited sticky → returns available", () => {
    const cached: CodexVerdict = {
      state: "rate-limited",
      checkedAt: staleTimestamp,
      sticky: true,
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("available");
    expect(result.sticky).toBe(false);
  });

  test("live available + non-sticky cached no-access → returns available", () => {
    // A cached no-access without sticky:true was not written by a real exec;
    // the cheap check's 'available' should win.
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date().toISOString(),
      sticky: false,
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("available");
    expect(result.sticky).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeOutput — full-text redaction (no line/length limits)
// ---------------------------------------------------------------------------

describe("sanitizeOutput — multi-line credential redaction", () => {
  test("strips ANSI escapes from full text", () => {
    const ESC = String.fromCharCode(27);
    const input = `line1\n${ESC}[31mred line${ESC}[0m\nline3`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain(ESC);
    expect(result).toContain("red line");
    expect(result).toContain("line1");
    expect(result).toContain("line3");
  });

  test("redacts sk- tokens across multiple lines", () => {
    const token = "sk-ABCDEFGHIJKLMNOPabcdefghijklmnop";
    const input = `line1\nerror: ${token}\nline3`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain(token);
    expect(result).toContain("sk-[redacted]");
    expect(result).toContain("line1");
    expect(result).toContain("line3");
  });

  test("does NOT cap length (operates on full text)", () => {
    const long = "x".repeat(500);
    const result = sanitizeOutput(long);
    expect(result.length).toBe(500);
  });

  test("redacts Bearer tokens on any line", () => {
    const input = `ok\nAuthorization header Bearer eyJhbGciOiJSUzI1NiJ9.pay.sig\ndone`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(result).toContain("Bearer [redacted]");
  });

  test("redacts Authorization: header value", () => {
    const input = `Authorization: secret_token_here\nother line`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain("secret_token_here");
    expect(result).toContain("Authorization: [redacted]");
  });

  test("OPENAI_API_KEY=<value> is redacted — env-var pattern covers *_API_KEY names", () => {
    // Business rule: env-var assignments exposing API keys must never reach
    // the verdict file or the statusline. The pattern targets *_API_KEY,
    // *_TOKEN, and *_SECRET names — common CI/CD credential conventions.
    const result = sanitizeOutput("OPENAI_API_KEY=sk-abcd1234efgh5678ijkl");
    expect(result).toContain("OPENAI_API_KEY=[redacted]");
    expect(result).not.toContain("sk-abcd1234efgh5678ijkl");
  });

  test("MY_TOKEN=<value> is redacted — env-var pattern covers *_TOKEN names", () => {
    const result = sanitizeOutput("MY_TOKEN=supersecretvalue");
    expect(result).toBe("MY_TOKEN=[redacted]");
  });

  test("GITHUB_SECRET=<value> is redacted — env-var pattern covers *_SECRET names", () => {
    const result = sanitizeOutput("GITHUB_SECRET=abc123");
    expect(result).toBe("GITHUB_SECRET=[redacted]");
  });

  test("Bearer:<token> (colon, no space) is redacted — colon is treated as separator", () => {
    // The regex uses [\s:]+ to capture both 'Bearer <tok>' and 'Bearer:<tok>'
    // so colon-separated variants are also caught.
    const result = sanitizeOutput("Bearer:tok_nospaces_here");
    expect(result).toContain("Bearer [redacted]");
    expect(result).not.toContain("tok_nospaces_here");
  });

  test("ordinary key=value pairs like count=5 or level=high are NOT mangled", () => {
    // The env-var pattern only targets uppercase names ending in _API_KEY,
    // _TOKEN, or _SECRET — lowercase or generic names must pass through.
    const plain = "count=5 level=high status=ok";
    expect(sanitizeOutput(plain)).toBe(plain);
  });
});

describe("reconcile — live 'available' + cached available", () => {
  test("live available + cached available (sticky:false) → available", () => {
    const cached: CodexVerdict = {
      state: "available",
      checkedAt: new Date(0).toISOString(),
      sticky: false,
    };
    const result = reconcile("available", cached);
    expect(result.state).toBe("available");
    expect(result.sticky).toBe(false);
  });

  test("result checkedAt is a valid ISO string close to now", () => {
    const before = Date.now();
    const cached: CodexVerdict = {
      state: "available",
      checkedAt: new Date(0).toISOString(),
      sticky: false,
    };
    const result = reconcile("available", cached);
    const after = Date.now();
    const ts = Date.parse(result.checkedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// reconcile — inconclusive 'unknown' live state (L1 CLI drift / keychain error)
// ---------------------------------------------------------------------------

describe("reconcile — live 'unknown' (inconclusive L1) lets L2 probe", () => {
  test("live unknown + no fresh sticky → unknown (gate proceeds to a real probe)", () => {
    // An ambiguous login-status failure must NOT block L2 the way unauthenticated
    // does — it falls through to 'unknown' so the real exec can classify it.
    const cached: CodexVerdict = {
      state: "available",
      checkedAt: new Date(0).toISOString(),
      sticky: false,
    };
    const result = reconcile("unknown", cached);
    expect(result.state).toBe("unknown");
    expect(result.sticky).toBe(false);
  });

  test("live unknown + fresh sticky rate-limited → cached kept (quota invisible to L1)", () => {
    const cached: CodexVerdict = {
      state: "rate-limited",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("unknown", cached);
    expect(result.state).toBe("rate-limited");
    expect(result.sticky).toBe(true);
    expect(result).toBe(cached);
  });

  test("live unknown + fresh sticky no-access → cached kept (entitlement invisible to L1)", () => {
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date().toISOString(),
      sticky: true,
    };
    const result = reconcile("unknown", cached);
    expect(result.state).toBe("no-access");
    expect(result).toBe(cached);
  });

  test("live unknown + stale sticky no-access → unknown (expired sticky no longer wins)", () => {
    const cached: CodexVerdict = {
      state: "no-access",
      checkedAt: new Date(0).toISOString(),
      sticky: true,
    };
    const result = reconcile("unknown", cached);
    expect(result.state).toBe("unknown");
    expect(result.sticky).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeOutput — broadened terminal-control stripping (CSI / OSC / C0)
// A buggy or hostile Codex must not smuggle cursor moves, screen clears,
// hyperlinks, or title-set payloads into cached details or echoed output.
// ---------------------------------------------------------------------------

describe("sanitizeOutput — terminal-control stripping beyond SGR colors", () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);

  test("strips OSC 8 hyperlink sequences (BEL-terminated), keeps visible text", () => {
    const input = `${ESC}]8;;https://evil.example/x${BEL}click me${ESC}]8;;${BEL}`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain(ESC);
    expect(result).not.toContain("https://evil.example");
    expect(result).toContain("click me");
  });

  test("strips OSC window-title sequences (ST-terminated)", () => {
    const input = `${ESC}]0;malicious title${ESC}\\visible`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain(ESC);
    expect(result).not.toContain("malicious title");
    expect(result).toContain("visible");
  });

  test("strips non-SGR CSI sequences (screen clear + cursor move)", () => {
    const input = `before${ESC}[2J${ESC}[1;1Hafter`;
    const result = sanitizeOutput(input);
    expect(result).not.toContain(ESC);
    expect(result).toBe("beforeafter");
  });

  test("strips a bare BEL control byte", () => {
    expect(sanitizeOutput(`ding${BEL}dong`)).toBe("dingdong");
  });

  test("preserves tab, newline, and carriage-return", () => {
    const input = "a\tb\nc\rd";
    expect(sanitizeOutput(input)).toBe(input);
  });

  test("strips a solitary ESC left by an incomplete sequence", () => {
    const result = sanitizeOutput(`oops${ESC}tail`);
    expect(result).not.toContain(ESC);
    expect(result).toContain("oops");
    expect(result).toContain("tail");
  });
});

// ---------------------------------------------------------------------------
// parseReviewArgs — CLI arg parsing for `codex-run.ts review`
// ---------------------------------------------------------------------------

describe("parseReviewArgs — default (no flags)", () => {
  test("no args → uncommitted scope, force false", () => {
    const result = parseReviewArgs([]);
    expect(result).toEqual({ ok: true, scope: { kind: "uncommitted" }, force: false });
  });

  test("--force alone → uncommitted scope, force true", () => {
    const result = parseReviewArgs(["--force"]);
    expect(result).toEqual({ ok: true, scope: { kind: "uncommitted" }, force: true });
  });
});

describe("parseReviewArgs — individual scope flags", () => {
  test("--staged → staged scope", () => {
    const result = parseReviewArgs(["--staged"]);
    expect(result).toEqual({ ok: true, scope: { kind: "staged" }, force: false });
  });

  test("--base <branch> → base scope with branch", () => {
    const result = parseReviewArgs(["--base", "main"]);
    expect(result).toEqual({ ok: true, scope: { kind: "base", branch: "main" }, force: false });
  });

  test("--commit <sha> → commit scope with sha", () => {
    const result = parseReviewArgs(["--commit", "abc1234"]);
    expect(result).toEqual({ ok: true, scope: { kind: "commit", sha: "abc1234" }, force: false });
  });

  test("--force combined with a scope flag → force true, scope set", () => {
    const result = parseReviewArgs(["--force", "--staged"]);
    expect(result).toEqual({ ok: true, scope: { kind: "staged" }, force: true });
  });

  test("scope flag before --force → same result regardless of order", () => {
    const result = parseReviewArgs(["--base", "develop", "--force"]);
    expect(result).toEqual({
      ok: true,
      scope: { kind: "base", branch: "develop" },
      force: true,
    });
  });

  test("--base without a following value → parse error", () => {
    const result = parseReviewArgs(["--base"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--base requires a branch argument");
  });

  test("--commit without a following value → parse error", () => {
    const result = parseReviewArgs(["--commit"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--commit requires a commit SHA argument");
  });
});

describe("parseReviewArgs — a flag-shaped token is never swallowed as a value", () => {
  test("--base --staged → --base treated as missing value, not '--staged' as the branch", () => {
    const result = parseReviewArgs(["--base", "--staged"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--base requires a branch argument");
  });

  test("--commit --force → --commit treated as missing value, not '--force' as the sha", () => {
    const result = parseReviewArgs(["--commit", "--force"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--commit requires a commit SHA argument");
  });

  test("--base --commit → --base treated as missing value, not '--commit' as the branch", () => {
    const result = parseReviewArgs(["--base", "--commit", "abc123"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--base requires a branch argument");
  });
});

describe("parseReviewArgs — duplicate scope flags are rejected, not silently overwritten", () => {
  test("--base main --base dev → parse error, does not silently take the last value", () => {
    const result = parseReviewArgs(["--base", "main", "--base", "dev"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--base passed more than once");
  });

  test("--staged --staged → parse error", () => {
    const result = parseReviewArgs(["--staged", "--staged"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--staged passed more than once");
  });

  test("--commit abc --commit def → parse error", () => {
    const result = parseReviewArgs(["--commit", "abc", "--commit", "def"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--commit passed more than once");
  });
});

describe("parseReviewArgs — --base/--commit values must be a safe git ref", () => {
  // Values are interpolated verbatim into the review instruction text Codex
  // reads and acts on. An option-like or shell-metacharacter value must be
  // rejected rather than silently steered into the git command Codex runs.
  test("--base '-s' → parse error (option-like value)", () => {
    const result = parseReviewArgs(["--base", "-s"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a valid git ref");
  });

  test("--base 'main; rm x' → parse error (shell metacharacters)", () => {
    const result = parseReviewArgs(["--base", "main; rm x"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a valid git ref");
  });

  test("--commit '$(x)' → parse error (command substitution)", () => {
    const result = parseReviewArgs(["--commit", "$(x)"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a valid git ref");
  });

  test("--commit backtick-wrapped value → parse error", () => {
    const result = parseReviewArgs(["--commit", "`whoami`"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a valid git ref");
  });

  test.each([["main"], ["feat/foo"], ["v1.2.3"], ["origin/main"], ["a".repeat(40)]])(
    "%s is accepted as a --base value",
    (ref) => {
      const result = parseReviewArgs(["--base", ref]);
      expect(result).toEqual({ ok: true, scope: { kind: "base", branch: ref }, force: false });
    },
  );

  test.each([["main"], ["feat/foo"], ["v1.2.3"], ["origin/main"], ["a".repeat(40)]])(
    "%s is accepted as a --commit value",
    (ref) => {
      const result = parseReviewArgs(["--commit", ref]);
      expect(result).toEqual({ ok: true, scope: { kind: "commit", sha: ref }, force: false });
    },
  );
});

describe("parseReviewArgs — mutual exclusion", () => {
  test("--staged + --base → parse error, does not pick either scope", () => {
    const result = parseReviewArgs(["--staged", "--base", "main"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  test("--staged + --commit → parse error", () => {
    const result = parseReviewArgs(["--staged", "--commit", "abc123"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  test("--base + --commit → parse error", () => {
    const result = parseReviewArgs(["--base", "main", "--commit", "abc123"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  test("all three scope flags combined → parse error", () => {
    const result = parseReviewArgs(["--staged", "--base", "main", "--commit", "abc123"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });
});

describe("parseReviewArgs — unrecognized arguments", () => {
  test("an unknown flag → parse error", () => {
    const result = parseReviewArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unrecognized argument");
  });

  test("a stray positional token → parse error", () => {
    const result = parseReviewArgs(["something"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unrecognized argument");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPrompt — diff-scope-to-instruction-text construction
// ---------------------------------------------------------------------------

describe("buildReviewPrompt — default (uncommitted) scope stays byte-identical", () => {
  // Locks in today's behavior: no flags passed must produce exactly the prompt
  // that shipped before scope presets existed, so existing callers/expectations
  // are unaffected.
  const ORIGINAL_PROMPT = [
    "You are performing an independent code review of the current uncommitted diff in this repository.",
    "",
    "Steps:",
    "1. Run `git status` to see which files are modified.",
    "2. Run `git diff` to see the full uncommitted changes (also check `git diff --cached` for staged changes).",
    "3. Review the diff for: correctness bugs, security issues (injection, secrets, unsafe operations),",
    "   and obvious quality problems (logic errors, missing error handling, type unsafety).",
    "4. Report your findings grouped by severity: HIGH, MEDIUM, LOW.",
    "   For each finding include: file + line range, description, and suggested fix.",
    "5. If the diff is clean, say so explicitly.",
    "",
    "Be concise and precise. Focus on real problems, not style preferences.",
  ].join("\n");

  test("uncommitted scope prompt matches the original hardcoded prompt exactly", () => {
    expect(buildReviewPrompt({ kind: "uncommitted" })).toBe(ORIGINAL_PROMPT);
  });
});

describe("buildReviewPrompt — scope-specific instructions", () => {
  test("staged scope tells Codex to run `git diff --cached` and ignore unstaged changes", () => {
    const prompt = buildReviewPrompt({ kind: "staged" });
    expect(prompt).toContain("git diff --cached");
    expect(prompt).toContain("Ignore any unstaged changes");
    expect(prompt).toContain("the currently staged diff in this repository");
  });

  test("base scope tells Codex to run a three-dot diff against the branch", () => {
    const prompt = buildReviewPrompt({ kind: "base", branch: "main" });
    expect(prompt).toContain("git diff main...HEAD");
    expect(prompt).toContain("merge base with `main`");
  });

  test("commit scope tells Codex to run `git show <sha>`", () => {
    const prompt = buildReviewPrompt({ kind: "commit", sha: "abc1234" });
    expect(prompt).toContain("git show abc1234");
    expect(prompt).toContain("commit `abc1234`");
  });

  test("step numbering stays sequential and renumbers around a single scope step", () => {
    // base/commit scopes contribute one step instead of two, so the shared
    // steps (review/report/clean-check) shift from 3/4/5 to 2/3/4.
    const prompt = buildReviewPrompt({ kind: "commit", sha: "deadbeef" });
    expect(prompt).toContain("1. Run `git show deadbeef`");
    expect(prompt).toContain("2. Review the diff for:");
    expect(prompt).toContain("3. Report your findings grouped by severity");
    expect(prompt).toContain("4. If the diff is clean, say so explicitly.");
  });

  test("all scopes end with the same closing guidance sentence", () => {
    const scopes = [
      { kind: "uncommitted" as const },
      { kind: "staged" as const },
      { kind: "base" as const, branch: "main" },
      { kind: "commit" as const, sha: "abc" },
    ];
    for (const scope of scopes) {
      expect(buildReviewPrompt(scope)).toContain(
        "Be concise and precise. Focus on real problems, not style preferences.",
      );
    }
  });
});
