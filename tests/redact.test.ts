// Tests for the canonical secret redactor (src/lib/redact.ts). This module
// is the union of what used to be two independently-evolved redactors
// (safety-net.ts's local redactSecrets, codex.ts's sanitizeOutput) — see M23
// in docs/audits/codebase-audit-2026-07-08.md. Every pattern from both
// originals, plus the explicitly-required GitHub token / AWS key / password=
// coverage, gets its own case here so a future edit can't silently narrow
// the union back down.

import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../src/lib/redact.ts";

describe("redactSecrets — sk- style API keys", () => {
  test("redacts a long sk- token", () => {
    const token = "sk-ABCDEFGHIJKLMNOPabcdefghijklmnop";
    const result = redactSecrets(`leaked: ${token} in output`);
    expect(result).not.toContain(token);
    expect(result).toContain("sk-[redacted]");
  });

  test("does not redact a too-short sk- token", () => {
    const result = redactSecrets("error: sk-short (small) context");
    expect(result).toContain("sk-short");
  });
});

describe("redactSecrets — GitHub tokens", () => {
  test("redacts a classic ghp_ personal access token", () => {
    const token = "ghp_1234567890abcdefghijklmnop";
    const result = redactSecrets(`git clone https://${token}@github.com/org/repo.git`);
    expect(result).not.toContain(token);
    expect(result).toContain("[redacted]");
  });

  test("redacts gho_/ghu_/ghs_/ghr_ prefixed tokens", () => {
    for (const prefix of ["gho", "ghu", "ghs", "ghr"]) {
      const token = `${prefix}_abcdefghijklmnopqrst`;
      const result = redactSecrets(`credential: ${token}`);
      expect(result).not.toContain(token);
    }
  });

  test("redacts a fine-grained github_pat_ token", () => {
    const token = `github_pat_${"A".repeat(30)}`;
    const result = redactSecrets(`Authorization header value ${token}`);
    expect(result).not.toContain(token);
  });
});

describe("redactSecrets — AWS access key IDs", () => {
  test("redacts an AKIA-prefixed access key", () => {
    const key = "AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(`aws configure set aws_access_key_id ${key}`);
    expect(result).not.toContain(key);
    expect(result).toContain("[redacted]");
  });
});

describe("redactSecrets — Bearer / Authorization", () => {
  test("redacts 'Bearer <token>'", () => {
    const result = redactSecrets("Authorization header Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig");
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(result).toContain("Bearer [redacted]");
  });

  test("redacts 'Bearer:<token>' (colon, no space)", () => {
    const result = redactSecrets("Bearer:tok_nospaces_here");
    expect(result).not.toContain("tok_nospaces_here");
    expect(result).toContain("Bearer [redacted]");
  });

  test("redacts 'Authorization: <value>'", () => {
    const result = redactSecrets("Authorization: token_secret_value_here");
    expect(result).not.toContain("token_secret_value_here");
    expect(result).toContain("Authorization: [redacted]");
  });
});

describe("redactSecrets — *_API_KEY/TOKEN/SECRET= env-var forms", () => {
  test("OPENAI_API_KEY=<value> is redacted as one unit, not nested with sk-[redacted]", () => {
    const result = redactSecrets("OPENAI_API_KEY=sk-abcd1234efgh5678ijkl");
    expect(result).toContain("OPENAI_API_KEY=[redacted]");
    expect(result).not.toContain("sk-abcd1234efgh5678ijkl");
  });

  test("MY_TOKEN=<value> is redacted", () => {
    expect(redactSecrets("MY_TOKEN=supersecretvalue")).toBe("MY_TOKEN=[redacted]");
  });

  test("GITHUB_SECRET=<value> is redacted", () => {
    expect(redactSecrets("GITHUB_SECRET=abc123")).toBe("GITHUB_SECRET=[redacted]");
  });
});

describe("redactSecrets — password=/token=/secret= query-string forms", () => {
  test("password=... is redacted (not covered by the *_SECRET/TOKEN pattern)", () => {
    const result = redactSecrets("curl -u user:password=hunter2 https://api.example.com");
    expect(result).not.toContain("hunter2");
    expect(result).toContain("password=[redacted]");
  });

  test("token=... stops at & so a following query param survives", () => {
    const result = redactSecrets("?token=abc123&foo=bar");
    expect(result).not.toContain("abc123");
    expect(result).toContain("foo=bar");
  });

  test("secret=... is redacted", () => {
    const result = redactSecrets("secret=shhh&other=1");
    expect(result).not.toContain("shhh");
    expect(result).toContain("secret=[redacted]");
  });
});

describe("redactSecrets — leaves non-secret text alone", () => {
  test("does not touch a plain command with no credential shapes", () => {
    const cmd = "git status && bun test tests/foo.test.ts";
    expect(redactSecrets(cmd)).toBe(cmd);
  });

  test("is idempotent on already-redacted text", () => {
    const once = redactSecrets("OPENAI_API_KEY=sk-abcd1234efgh5678ijkl");
    expect(redactSecrets(once)).toBe(once);
  });
});
