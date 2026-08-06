import { describe, expect, test } from "bun:test";
import {
  buildSteerMessage,
  CACHE_STALE_MS,
  CRITICAL_REMIND_MS,
  computeBand,
  formatTimeToReset,
  mergeSessionRateLimits,
  RATE_LIMITS_SESSION_CAP,
  resolveRateLimits,
  type SessionRateLimits,
  type SessionRateLimitsMap,
  shouldEmit,
} from "../src/lib/quota.ts";

describe("computeBand", () => {
  test("five-hour boundaries", () => {
    expect(computeBand(59, undefined)).toBe("normal");
    expect(computeBand(60, undefined)).toBe("elevated");
    expect(computeBand(84, undefined)).toBe("elevated");
    expect(computeBand(85, undefined)).toBe("critical");
  });

  test("seven-day boundaries", () => {
    expect(computeBand(undefined, 64)).toBe("normal");
    expect(computeBand(undefined, 65)).toBe("elevated");
    expect(computeBand(undefined, 84)).toBe("elevated");
    expect(computeBand(undefined, 85)).toBe("critical");
  });

  test("undefined dimensions are normal", () => {
    expect(computeBand(undefined, undefined)).toBe("normal");
  });

  test("returns max severity across dimensions", () => {
    expect(computeBand(59, 65)).toBe("elevated");
    expect(computeBand(60, 85)).toBe("critical");
    expect(computeBand(85, 64)).toBe("critical");
  });

  test("exhausted boundary at 95%", () => {
    expect(computeBand(94, undefined)).toBe("critical");
    expect(computeBand(95, undefined)).toBe("exhausted");
    expect(computeBand(undefined, 95)).toBe("exhausted");
    expect(computeBand(96, 85)).toBe("exhausted");
  });
});

describe("shouldEmit", () => {
  const now = 1_000_000;

  test("null previous state", () => {
    expect(shouldEmit(null, "normal", now)).toBe(false);
    expect(shouldEmit(null, "elevated", now)).toBe(true);
  });

  test("same severity does not repeat except critical reminder interval", () => {
    expect(shouldEmit({ band: "elevated", lastEmit: now - 1 }, "elevated", now)).toBe(false);
    expect(shouldEmit({ band: "critical", lastEmit: now - 1 }, "critical", now)).toBe(false);
    expect(
      shouldEmit({ band: "critical", lastEmit: now - CRITICAL_REMIND_MS }, "critical", now),
    ).toBe(true);
  });

  test("severity transitions", () => {
    expect(shouldEmit({ band: "elevated", lastEmit: now - 1 }, "critical", now)).toBe(true);
    expect(
      shouldEmit({ band: "critical", lastEmit: now - CRITICAL_REMIND_MS }, "elevated", now),
    ).toBe(false);
    expect(
      shouldEmit({ band: "critical", lastEmit: now - CRITICAL_REMIND_MS }, "normal", now),
    ).toBe(false);
    expect(
      shouldEmit({ band: "elevated", lastEmit: now - CRITICAL_REMIND_MS }, "normal", now),
    ).toBe(false);
  });

  test("exhausted always emits", () => {
    expect(shouldEmit({ band: "exhausted", lastEmit: now - 1 }, "exhausted", now)).toBe(true);
    expect(shouldEmit(null, "exhausted", now)).toBe(true);
    expect(shouldEmit({ band: "critical", lastEmit: now - 1 }, "exhausted", now)).toBe(true);
  });
});

describe("buildSteerMessage", () => {
  test("available elevated message includes percentages, codex, and batching", () => {
    const msg = buildSteerMessage("elevated", "available", 61, 66);
    expect(msg).toContain("[quota:elevated]");
    expect(msg).toContain("5h 61%");
    expect(msg).toContain("7d 66%");
    expect(msg.toLowerCase()).toContain("codex");
    expect(msg.toLowerCase()).toContain("batched");
    expect(msg.toLowerCase()).toContain("few large");
  });

  test("available critical message is stronger than elevated", () => {
    const elevated = buildSteerMessage("elevated", "available", 61, 66);
    const critical = buildSteerMessage("critical", "available", 86, 90);
    expect(critical).toContain("[quota:critical]");
    expect(critical).toContain("5h 86%");
    expect(critical).toContain("7d 90%");
    expect(critical).toContain("Avoid Opus/Fable subagents entirely");
    expect(critical).toContain("all executable work");
    expect(elevated).not.toContain("Avoid Opus/Fable subagents entirely");
  });

  test("unavailable elevated message mentions sonnet downshift and codex state", () => {
    const msg = buildSteerMessage("elevated", "unauthenticated", 70, undefined);
    expect(msg).toContain("5h 70%");
    expect(msg).toContain("7d unknown");
    expect(msg).toContain("sonnet");
    expect(msg).toContain("Codex bridge is unauthenticated");
    expect(msg).toContain("do not attempt the codex bridge");
  });

  test("unavailable critical message mentions sonnet downshift and codex state", () => {
    const msg = buildSteerMessage("critical", "rate-limited", undefined, 90);
    expect(msg).toContain("5h unknown");
    expect(msg).toContain("7d 90%");
    expect(msg).toContain("sonnet");
    expect(msg).toContain("Codex bridge is rate-limited");
    expect(msg).toContain("do not attempt the codex bridge");
  });

  test("exhausted + available routes to codex and tells the user", () => {
    const msg = buildSteerMessage("exhausted", "available", 97, 90);
    expect(msg).toContain("[quota:exhausted]");
    expect(msg).toContain("codex-run.ts exec");
    expect(msg).toContain("tell the user");
  });

  test("exhausted + available with resets_at mentions time to reset", () => {
    const future = String(Math.floor(Date.now() / 1000) + 7200);
    const msg = buildSteerMessage("exhausted", "available", 97, 90, future);
    expect(msg).toContain("resets in");
  });

  test("exhausted + unauthenticated recommends /model sonnet and tells the user", () => {
    const msg = buildSteerMessage("exhausted", "unauthenticated", 97, 90);
    expect(msg).toContain("/model sonnet");
    expect(msg).toContain("tell the user");
  });

  test("exhausted via weekly window only binds the reset note to the weekly window", () => {
    const sevenDayFuture = String(Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60);
    const msg = buildSteerMessage("exhausted", "available", 40, 97, undefined, sevenDayFuture);
    expect(msg).toContain("weekly window resets in");
  });

  test("exhausted via both windows binds the reset note to the 5h window (resets first)", () => {
    const fiveHourFuture = String(Math.floor(Date.now() / 1000) + 7200);
    const sevenDayFuture = String(Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60);
    const msg = buildSteerMessage("exhausted", "available", 97, 97, fiveHourFuture, sevenDayFuture);
    expect(msg).toContain("5h window resets in");
  });
});

describe("resolveRateLimits — multi-session clobber fix", () => {
  const now = 1_000_000_000;

  function entry(
    fiveHourPct: number | undefined,
    sevenDayPct: number | undefined,
    ageMs: number,
    resetsAt = "1785171600",
  ): SessionRateLimits {
    return {
      five_hour:
        fiveHourPct === undefined
          ? undefined
          : { used_percentage: fiveHourPct, resets_at: resetsAt },
      seven_day:
        sevenDayPct === undefined
          ? undefined
          : { used_percentage: sevenDayPct, resets_at: resetsAt },
      updated_at: now - ageMs,
    };
  }

  test("prunes sessions older than staleMs and takes the max of survivors", () => {
    const sessions: SessionRateLimitsMap = {
      // Stale — older than CACHE_STALE_MS — must be excluded even though it
      // has the highest raw percentage.
      "session-stale": entry(99, 99, CACHE_STALE_MS + 1),
      // Two fresh sessions with different readings — max wins per window.
      "session-low": entry(8, 25, 1_000),
      "session-high": entry(67, 71, 500),
    };

    const resolved = resolveRateLimits(sessions, now);

    expect(resolved).not.toBeNull();
    expect(resolved?.five_hour?.used_percentage).toBe(67);
    expect(resolved?.seven_day?.used_percentage).toBe(71);
  });

  test("independent max per window — a session can win 5h without winning 7d", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(80, 10, 100),
      "session-b": entry(20, 90, 200),
    };

    const resolved = resolveRateLimits(sessions, now);

    expect(resolved?.five_hour?.used_percentage).toBe(80);
    expect(resolved?.seven_day?.used_percentage).toBe(90);
  });

  test("all sessions stale → null (unknown), never a stale/default number", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(90, 90, CACHE_STALE_MS + 1),
      "session-b": entry(10, 10, CACHE_STALE_MS * 5),
    };

    expect(resolveRateLimits(sessions, now)).toBeNull();
  });

  test("empty map → null (unknown)", () => {
    expect(resolveRateLimits({}, now)).toBeNull();
    expect(resolveRateLimits(undefined, now)).toBeNull();
  });

  test("boundary — exactly at staleMs still counts as fresh", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(42, 42, CACHE_STALE_MS),
    };

    expect(resolveRateLimits(sessions, now)?.five_hour?.used_percentage).toBe(42);
  });

  test("a session missing one window doesn't block the other window's result", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(50, undefined, 100),
    };

    const resolved = resolveRateLimits(sessions, now);
    expect(resolved?.five_hour?.used_percentage).toBe(50);
    expect(resolved?.seven_day).toBeUndefined();
  });

  test("resolved updated_at is the freshest surviving session's timestamp", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(10, 10, 5_000),
      "session-b": entry(20, 20, 500),
    };

    const resolved = resolveRateLimits(sessions, now);
    expect(resolved?.updated_at).toBe(now - 500);
  });

  test("custom staleMs overrides the default CACHE_STALE_MS", () => {
    const sessions: SessionRateLimitsMap = {
      "session-a": entry(10, 10, 2_000),
    };

    expect(resolveRateLimits(sessions, now, 1_000)).toBeNull();
    expect(resolveRateLimits(sessions, now, 3_000)?.five_hour?.used_percentage).toBe(10);
  });
});

describe("mergeSessionRateLimits", () => {
  test("adds a new session entry", () => {
    const result = mergeSessionRateLimits({}, "session-a", {
      five_hour: { used_percentage: 10, resets_at: "123" },
      updated_at: 1000,
    });
    expect(result["session-a"]?.five_hour?.used_percentage).toBe(10);
  });

  test("refreshes an existing session's entry rather than duplicating it", () => {
    const initial = mergeSessionRateLimits({}, "session-a", {
      five_hour: { used_percentage: 10, resets_at: "123" },
      updated_at: 1000,
    });
    const refreshed = mergeSessionRateLimits(initial, "session-a", {
      five_hour: { used_percentage: 20, resets_at: "456" },
      updated_at: 2000,
    });
    expect(Object.keys(refreshed)).toEqual(["session-a"]);
    expect(refreshed["session-a"]?.five_hour?.used_percentage).toBe(20);
  });

  test("caps the map at RATE_LIMITS_SESSION_CAP, dropping the oldest entries", () => {
    let sessions: SessionRateLimitsMap = {};
    for (let i = 0; i < RATE_LIMITS_SESSION_CAP + 10; i++) {
      sessions = mergeSessionRateLimits(sessions, `session-${i}`, {
        five_hour: { used_percentage: i, resets_at: "1" },
        updated_at: i, // increasing — later entries are "newer"
      });
    }
    expect(Object.keys(sessions).length).toBe(RATE_LIMITS_SESSION_CAP);
    // The oldest (lowest updated_at) sessions were dropped.
    expect(sessions["session-0"]).toBeUndefined();
    // The newest session survives.
    expect(sessions[`session-${RATE_LIMITS_SESSION_CAP + 9}`]).toBeDefined();
  });
});

describe("formatTimeToReset", () => {
  test("epoch-seconds string 2h in the future formats as HhMMm", () => {
    const future = String(Math.floor(Date.now() / 1000) + 7200);
    expect(formatTimeToReset(future)).toMatch(/^\d+h\d{2}m$/);
  });

  test("past value returns null", () => {
    expect(formatTimeToReset("1000000")).toBeNull();
  });

  test("undefined returns null", () => {
    expect(formatTimeToReset(undefined)).toBeNull();
  });

  test("epoch-seconds string 3 days in the future formats as DdHh", () => {
    const future = String(Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60);
    expect(formatTimeToReset(future)).toMatch(/^\d+d\d+h$/);
  });
});
