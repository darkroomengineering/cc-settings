import { describe, expect, test } from "bun:test";
import {
  buildSteerMessage,
  CRITICAL_REMIND_MS,
  computeBand,
  formatTimeToReset,
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
