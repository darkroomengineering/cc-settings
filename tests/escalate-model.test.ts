// e2e tests for escalate-model.ts and post-failure.ts, plus unit tests for
// the signature normalization (problem-signature.ts) and per-session
// announcement logic (escalate.ts) they depend on. Sandboxed-HOME pattern
// matches tool-cadence.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildEscalateMessage,
  type EscalateState,
  shouldEscalate,
  topUnannouncedSignature,
  withAnnouncement,
} from "../src/lib/escalate.ts";
import {
  computeSignatureKey,
  normalizeErrorText,
  sanitizeSample,
} from "../src/lib/problem-signature.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "escalate-model.ts");
const POST_FAILURE = resolve(import.meta.dir, "..", "src", "scripts", "post-failure.ts");
const SESSION_ID = "sess-escalate-1";

interface SignatureMapFixture {
  [key: string]: { count: number; tool: string; sample: string };
}

interface EscalateStateFixture {
  bySession: Record<string, string[]>;
  sessionOrder: string[];
  lastEmit: number;
}

async function runHook(
  home: string,
  opts: { sessionId?: string; threshold?: string } = {},
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CC_ESCALATE_THRESHOLD: opts.threshold ?? "3",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    JSON.stringify({ prompt: "still broken", session_id: opts.sessionId ?? SESSION_ID }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function runPostFailure(
  home: string,
  opts: { sessionId: string; toolName: string; error: string; cwd?: string; toolUseId?: string },
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", POST_FAILURE], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    JSON.stringify({
      session_id: opts.sessionId,
      tool_name: opts.toolName,
      error: opts.error,
      cwd: opts.cwd ?? "/tmp",
      tool_use_id: opts.toolUseId ?? "tu_1",
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function readSignatures(home: string, sessionId: string): Promise<SignatureMapFixture> {
  try {
    return JSON.parse(
      await Bun.file(join(home, ".claude", "tmp", `problem-signatures-${sessionId}`)).text(),
    );
  } catch {
    return {};
  }
}

async function writeSignatures(
  home: string,
  sessionId: string,
  map: SignatureMapFixture,
): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  // No .json suffix — matches the real state-file naming convention
  // (post-failure.ts's tool-failure-counts-<session> has none either).
  await writeFile(join(dir, `problem-signatures-${sessionId}`), JSON.stringify(map));
}

// Writes the per-session `sessions` map (src/lib/quota.ts's resolveRateLimits
// reads THIS, not the flat top-level fields) — a single fixture session,
// keyed under the same SESSION_ID escalate-model.ts's runHook uses, so
// resolveRateLimits's staleness prune sees a fresh entry. Flat top-level
// fields are also written for parity with what statusline.ts's real writer
// produces (Programa-compat derived fields), though escalate-model.ts itself
// no longer reads them directly.
async function writeRateLimitsCache(
  home: string,
  cache: {
    updated_at: number;
    five_hour?: { used_percentage?: number };
    seven_day?: { used_percentage?: number };
  },
): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "rate-limits.json"),
    JSON.stringify({
      ...cache,
      sessions: {
        [SESSION_ID]: {
          five_hour: cache.five_hour,
          seven_day: cache.seven_day,
          updated_at: cache.updated_at,
        },
      },
    }),
  );
}

async function writeEscalateStateFixture(home: string, state: EscalateStateFixture): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "escalate-model-state.json"), JSON.stringify(state));
}

async function writeSessionModelFixture(
  home: string,
  sessionId: string,
  displayName: string,
): Promise<void> {
  const dir = join(home, ".claude", "tmp");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "session-models.json"),
    JSON.stringify({ [sessionId]: { m: displayName, t: Date.now() } }),
  );
}

describe("escalate-model — e2e", () => {
  test("below threshold → silent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 2, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout, exit } = await runHook(home);
      expect(stdout).toBe("");
      expect(exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("at threshold → emits, message names the tool and mentions fable", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout, exit } = await runHook(home);
      expect(exit).toBe(0);
      expect(stdout).toContain("hookSpecificOutput");
      expect(stdout).toContain("Bash");
      expect(stdout.toLowerCase()).toContain("fable");
      expect(stdout).toContain("3");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("same signature twice → speaks only once", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const first = await runHook(home);
      expect(first.stdout).toContain("hookSpecificOutput");

      // Unchanged signature map — same signature, still at count 3.
      const second = await runHook(home);
      expect(second.stdout).toBe("");
      expect(second.exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("critical quota band → silent even at threshold", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 5, tool: "Bash", sample: "command not found: foo" },
      });
      await writeRateLimitsCache(home, {
        updated_at: Date.now(),
        five_hour: { used_percentage: 90 },
        seven_day: { used_percentage: 40 },
      });
      const { stdout, exit } = await runHook(home);
      expect(stdout).toBe("");
      expect(exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("elevated quota band → silent (would otherwise contradict quota-steer's sonnet-only guidance)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await writeRateLimitsCache(home, {
        updated_at: Date.now(),
        five_hour: { used_percentage: 65 },
        seven_day: { used_percentage: 40 },
      });
      const { stdout, exit } = await runHook(home);
      expect(stdout).toBe("");
      expect(exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("normal quota band → fires", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await writeRateLimitsCache(home, {
        updated_at: Date.now(),
        five_hour: { used_percentage: 10 },
        seven_day: { used_percentage: 10 },
      });
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("unknown quota band (no cache) → fires", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("debounced: a second, different signature cannot fire within 10 minutes of the first", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const first = await runHook(home);
      expect(first.stdout).toContain("hookSpecificOutput");

      // A brand new, different signature at threshold in the SAME session —
      // still inside the 10-minute debounce window from the first emit.
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
        def456: { count: 3, tool: "Edit", sample: "permission denied" },
      });
      const second = await runHook(home);
      expect(second.stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("no signatures recorded → silent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const { stdout, exit } = await runHook(home);
      expect(stdout).toBe("");
      expect(exit).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("announcing a signature in session A does not suppress it in session B", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const longAgo = Date.now() - 20 * 60_000; // past the 10-minute global debounce
      await writeEscalateStateFixture(home, {
        bySession: { "sess-A": ["abc123"] },
        sessionOrder: ["sess-A"],
        lastEmit: longAgo,
      });
      await writeSignatures(home, "sess-B", {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout } = await runHook(home, { sessionId: "sess-B" });
      expect(stdout).toContain("hookSpecificOutput");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("after the leader is announced, the next-highest unannounced signature can fire", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const longAgo = Date.now() - 20 * 60_000;
      await writeEscalateStateFixture(home, {
        bySession: { [SESSION_ID]: ["leaderKey"] },
        sessionOrder: [SESSION_ID],
        lastEmit: longAgo,
      });
      await writeSignatures(home, SESSION_ID, {
        leaderKey: { count: 10, tool: "Bash", sample: "leader error" },
        runnerUpKey: { count: 3, tool: "Edit", sample: "runner up error" },
      });
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
      expect(stdout).toContain("Edit");
      expect(stdout).not.toContain("leader error");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("post-failure.ts — signature hashing and sample sanitization", () => {
  test("errors identical for 300 chars then differing produce different signatures", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const prefix = "x".repeat(300);
      await runPostFailure(home, {
        sessionId: "sess-trunc",
        toolName: "Bash",
        error: `${prefix} AAAA tail one`,
      });
      await runPostFailure(home, {
        sessionId: "sess-trunc",
        toolName: "Bash",
        error: `${prefix} BBBB tail two`,
      });
      const sigs = await readSignatures(home, "sess-trunc");
      expect(Object.keys(sigs).length).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("credential-shaped token is redacted before storage and in the built message", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const secretError = "curl failed: Authorization: Bearer sk-abcdefghij1234567890 rejected";
      await runPostFailure(home, {
        sessionId: "sess-secret",
        toolName: "Bash",
        error: secretError,
      });
      const sigs = await readSignatures(home, "sess-secret");
      const entries = Object.entries(sigs);
      expect(entries.length).toBe(1);
      const [key, entry] = entries[0] as [string, SignatureMapFixture[string]];
      expect(entry.sample).not.toContain("sk-abcdefghij1234567890");
      expect(entry.sample).toContain("[redacted]");

      const message = buildEscalateMessage({ key, entry }, 3);
      expect(message).not.toContain("sk-abcdefghij1234567890");
      expect(message).toContain("[redacted]");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("multi-line / control-character error is flattened to one line in storage", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const messy = "line one failed\nline two\tdetails\r\nline three\x01\x02 end";
      await runPostFailure(home, {
        sessionId: "sess-multiline",
        toolName: "Bash",
        error: messy,
      });
      const sigs = await readSignatures(home, "sess-multiline");
      const [, entry] = Object.entries(sigs)[0] as [string, SignatureMapFixture[string]];
      expect(entry.sample).not.toMatch(/[\n\r]/);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting control chars were stripped from untrusted tool output
      expect(entry.sample).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(entry.sample).toContain("line one failed line two");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("sanitizeSample", () => {
  test("redacts credential-shaped substrings", () => {
    const result = sanitizeSample("token=abc123456789 rest of message");
    expect(result).not.toContain("abc123456789");
    expect(result).toContain("[redacted]");
  });

  test("flattens control characters and collapses whitespace", () => {
    const result = sanitizeSample("a\nb\tc\r\nd\x01e");
    expect(result).not.toMatch(/[\n\r\t]/);
    expect(result).toBe("a b c d e");
  });
});

describe("problem-signature normalization", () => {
  test("line numbers, absolute paths, and large incidental integers collapse to the same signature", () => {
    const a = "Error at /Users/frz/project/src/foo.ts:12:34 — worker pid 48291 crashed";
    const b = "Error at /Users/alice/other/src/foo.ts:99:2 — worker pid 51700 crashed";
    expect(computeSignatureKey("Bash", a)).toBe(computeSignatureKey("Bash", b));
  });

  test("normalized text replaces the varying parts with stable placeholders", () => {
    const normalized = normalizeErrorText(
      "Error at /Users/frz/project/src/foo.ts:12:34 — worker pid 48291 crashed",
    );
    expect(normalized).not.toContain("/users/frz");
    expect(normalized).not.toContain("12:34");
    expect(normalized).not.toContain("48291");
    expect(normalized).toContain("<path>");
    expect(normalized).toContain("<loc>");
    expect(normalized).toContain("<n>");
  });

  test("small integers (exit codes, status codes) are preserved, not collapsed", () => {
    expect(computeSignatureKey("Bash", "process exited with exit code 1")).not.toBe(
      computeSignatureKey("Bash", "process exited with exit code 137"),
    );
    expect(computeSignatureKey("Bash", "process exited with exit code 1")).not.toBe(
      computeSignatureKey("Bash", "process exited with exit code 143"),
    );
    expect(computeSignatureKey("Bash", "request failed with status 401")).not.toBe(
      computeSignatureKey("Bash", "request failed with status 500"),
    );
  });

  test("4+ digit incidental integers (pids, ports) still collapse", () => {
    const a = "worker crashed, pid 48291 killed";
    const b = "worker crashed, pid 51002 killed";
    expect(computeSignatureKey("Bash", a)).toBe(computeSignatureKey("Bash", b));
  });

  test("genuinely different errors do not collapse to the same signature", () => {
    const a = "Cannot find module 'foo'";
    const b = "Permission denied writing to /etc/hosts";
    expect(computeSignatureKey("Bash", a)).not.toBe(computeSignatureKey("Bash", b));
  });

  test("same normalized error under different tool names does not collapse", () => {
    const err = "command not found: foo";
    expect(computeSignatureKey("Bash", err)).not.toBe(computeSignatureKey("Edit", err));
  });
});

describe("escalate.ts — per-session announcements", () => {
  const baseState: EscalateState = { bySession: {}, sessionOrder: [], lastEmit: 0 };

  test("topUnannouncedSignature skips signatures already announced for this session", () => {
    const map = {
      leader: { count: 5, tool: "Bash", sample: "leader error" },
      runnerUp: { count: 3, tool: "Edit", sample: "runner up error" },
    };
    const state = withAnnouncement(baseState, "sess-a", "leader", 0);
    const top = topUnannouncedSignature(map, state, "sess-a");
    expect(top?.key).toBe("runnerUp");
  });

  test("an announcement in one session does not suppress the same signature in another session", () => {
    const map = { shared: { count: 5, tool: "Bash", sample: "shared error" } };
    const state = withAnnouncement(baseState, "sess-a", "shared", 0);
    const topInB = topUnannouncedSignature(map, state, "sess-b");
    expect(topInB?.key).toBe("shared");
  });

  test("shouldEscalate: threshold, global debounce, and elevated/critical band gates", () => {
    const top = { key: "k", entry: { count: 5, tool: "Bash", sample: "x" } };
    // A realistic "now" far past epoch 0, so the never-emitted lastEmit:0
    // default doesn't itself look like a recent emission.
    const now = Date.now();
    const neverEmitted: EscalateState = { bySession: {}, sessionOrder: [], lastEmit: 0 };
    expect(shouldEscalate(top, 3, neverEmitted, now, "normal")).toBe(true);
    expect(shouldEscalate(top, 3, neverEmitted, now, "unknown")).toBe(true);
    expect(shouldEscalate(top, 3, neverEmitted, now, "elevated")).toBe(false);
    expect(shouldEscalate(top, 3, neverEmitted, now, "critical")).toBe(false);
    expect(shouldEscalate(top, 6, neverEmitted, now, "normal")).toBe(false); // below threshold
    const debounced: EscalateState = { bySession: {}, sessionOrder: [], lastEmit: now - 1000 };
    expect(shouldEscalate(top, 3, debounced, now, "normal")).toBe(false); // within debounce
  });

  test("shouldEscalate: exhausted band suppresses even when count/threshold/debounce all allow it", () => {
    const top = { key: "k", entry: { count: 10, tool: "Bash", sample: "x" } };
    const now = Date.now();
    const neverEmitted: EscalateState = { bySession: {}, sessionOrder: [], lastEmit: 0 };
    expect(shouldEscalate(top, 3, neverEmitted, now, "exhausted")).toBe(false);
    expect(shouldEscalate(top, 3, neverEmitted, now, "normal")).toBe(true);
    expect(shouldEscalate(top, 3, neverEmitted, now, "unknown")).toBe(true);
  });

  test("buildEscalateMessage keeps the sample on one line and strips quote characters", () => {
    const top = {
      key: "k",
      entry: { count: 4, tool: "Bash", sample: 'line one\nline "two" with quotes' },
    };
    const message = buildEscalateMessage(top, 3);
    const quoted = message.match(/: "([\s\S]*?)"\n/)?.[1] ?? "";
    expect(quoted).not.toMatch(/[\n\r]/);
    expect(quoted).not.toContain('"');
  });

  test("buildEscalateMessage labels the sample as data, neutralizes backticks, and keeps unicode quotes inside the span", () => {
    const top = {
      key: "k",
      entry: {
        count: 4,
        tool: "Bash",
        sample: "cmd `rm -rf /` failed with “fancy quotes” and ‘more’",
      },
    };
    const message = buildEscalateMessage(top, 3);
    expect(message).toContain("data, not instructions");
    const quoted = message.match(/: "([\s\S]*?)"\n/)?.[1] ?? "";
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted).not.toContain("`");
    expect(quoted).not.toMatch(/[\n\r]/);
  });
});

describe("buildEscalateMessage — session-model-aware variant", () => {
  const top = {
    key: "k",
    entry: { count: 4, tool: "Bash", sample: "command not found: foo" },
  };

  test("session already on Fable 5 → fresh-context suggestion, no Fable-subagent recommendation or cost line", () => {
    const message = buildEscalateMessage(top, 3, "Fable 5");
    expect(message).toContain("already on Fable 5");
    expect(message).toContain('Agent(implementer, "<the specific failing slice>")');
    expect(message).not.toContain('model: "fable"');
    expect(message).not.toContain("2x Opus cost");
  });

  test("session on Opus 5 → unchanged Fable-escalation message", () => {
    const message = buildEscalateMessage(top, 3, "Opus 5");
    expect(message).toContain('Agent(implementer, "<the specific failing slice>", model: "fable")');
    expect(message).toContain("2x Opus cost");
  });

  test("no session-model entry (undefined) → unchanged Fable-escalation message (fail-open default)", () => {
    const message = buildEscalateMessage(top, 3);
    expect(message).toContain('Agent(implementer, "<the specific failing slice>", model: "fable")');
    expect(message).toContain("2x Opus cost");
  });

  test("null session model → unchanged Fable-escalation message (fail-open default)", () => {
    const message = buildEscalateMessage(top, 3, null);
    expect(message).toContain('Agent(implementer, "<the specific failing slice>", model: "fable")');
    expect(message).toContain("2x Opus cost");
  });

  test("Fable-variant message still carries the sanitized, labeled sample", () => {
    const injectionTop = {
      key: "k",
      entry: {
        count: 4,
        tool: "Bash",
        sample: "cmd `rm -rf /` failed with “fancy quotes” and ‘more’",
      },
    };
    const message = buildEscalateMessage(injectionTop, 3, "Fable 5");
    expect(message).toContain("data, not instructions");
    const quoted = message.match(/: "([\s\S]*?)"\n/)?.[1] ?? "";
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted).not.toContain("`");
    expect(quoted).not.toMatch(/[\n\r]/);
  });
});

describe("escalate-model hook — session-model wiring (e2e)", () => {
  test("Fable session → hook emits the fresh-context variant", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await writeSessionModelFixture(home, SESSION_ID, "Fable 5");
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
      expect(stdout).toContain("already on Fable 5");
      expect(stdout).not.toContain('model: \\"fable\\"');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("Opus session → hook keeps recommending the Fable subagent", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      await writeSessionModelFixture(home, SESSION_ID, "Opus 5");
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
      expect(stdout.toLowerCase()).toContain("fable");
      expect(stdout).toContain('model: \\"fable\\"');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("no session-models.json → hook keeps the fail-open Fable-subagent default", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, SESSION_ID, {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout } = await runHook(home);
      expect(stdout).toContain("hookSpecificOutput");
      expect(stdout).toContain('model: \\"fable\\"');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("post-failure.ts / sanitizeSample — truncate-before-redact credential leak (Fix 1)", () => {
  test("an AWS key split by the old 200-char truncation is fully redacted, no AKIA-prefixed fragment survives", () => {
    const full = `${"x".repeat(193)}AKIAABCDEFGHIJ1234567890`;
    const result = sanitizeSample(full);
    expect(result).not.toMatch(/AKIA[A-Z0-9]/);
    expect(result).toContain("[redacted]");
  });

  test("an sk- token split by the old 200-char truncation is fully redacted", () => {
    // 192 padding + "sk-" (3) = 195; the old 200-char cut would have left only
    // 5 trailing chars ("abcde") after "sk-", below the pattern's 10-char
    // minimum, leaking "sk-abcde" in the stored/logged sample.
    const full = `${"x".repeat(192)}sk-abcdefghij1234567890`;
    const result = sanitizeSample(full);
    expect(result).not.toContain("abcde");
    expect(result).toContain("sk-[redacted]");
  });

  test("a github_pat_ token split by the old 200-char truncation is fully redacted", () => {
    // 179 padding + "github_pat_" (11) = 190; the old 200-char cut would have
    // left only 10 trailing chars, below the pattern's 20-char minimum.
    const secret = "A".repeat(30);
    const full = `${"x".repeat(179)}github_pat_${secret}`;
    const result = sanitizeSample(full);
    expect(result).not.toContain(secret.slice(0, 10));
    expect(result).toContain("[redacted]");
  });

  test("the log-line value is redacted, not raw (Fix 2)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      const secretError = "curl failed: Authorization: Bearer sk-logsecrettoken1234567 rejected";
      await runPostFailure(home, {
        sessionId: "sess-log-secret",
        toolName: "Bash",
        error: secretError,
      });
      const logText = await Bun.file(join(home, ".claude", "logs", "tool-failures.log")).text();
      expect(logText).not.toContain("sk-logsecrettoken1234567");
      expect(logText).toContain("[redacted]");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("an invalid session id falls back to the unknown bucket for both state files, never appears in a filename (Fix 3)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await runPostFailure(home, { sessionId: "../evil", toolName: "Bash", error: "boom" });
      const tmpFiles = await readdir(join(home, ".claude", "tmp"));
      expect(tmpFiles.some((f) => f.includes(".."))).toBe(false);
      expect(tmpFiles).toContain("problem-signatures-unknown");
      expect(tmpFiles).toContain("tool-failure-counts-unknown");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("escalate-model hook falls back to the unknown bucket for an invalid session id (Fix 3)", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-escalate-"));
    try {
      await writeSignatures(home, "unknown", {
        abc123: { count: 3, tool: "Bash", sample: "command not found: foo" },
      });
      const { stdout } = await runHook(home, { sessionId: "../evil" });
      expect(stdout).toContain("hookSpecificOutput");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
