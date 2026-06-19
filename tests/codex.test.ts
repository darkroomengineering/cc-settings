// Unit tests for pure exported functions in src/lib/codex.ts.
// No filesystem I/O, no subprocess spawning — pure logic only.

import { describe, expect, test } from "bun:test";
import {
  type CodexVerdict,
  classifyCodexError,
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
