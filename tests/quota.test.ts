import { describe, expect, test } from "bun:test";
import {
  buildSteerMessage,
  CRITICAL_REMIND_MS,
  computeBand,
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
});
