// trimLedger was the one session-ledger export with no direct coverage, and it
// is the module's only read-modify-write — it rewrites a file that two hook
// processes append to. These tests pin the three things that matter: the cap is
// enforced, the NEWEST lines survive (a digest that kept the oldest would be
// worse than none), and the size gate never skips a trim that was actually due.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntries,
  LEDGER_MAX_LINES,
  LEDGER_TRIM_TO,
  type LedgerEntry,
  trimLedger,
} from "../src/lib/session-ledger.ts";

const T = "2026-07-31T14:22:03.111Z";

/** A realistic entry — path length is what makes real ledgers big, so use one
 *  representative of an actual repo path rather than a one-character stub. */
function line(n: number): string {
  return JSON.stringify({
    t: T,
    kind: "change",
    path: `src/lib/module-${n}.ts`,
    tool: "Edit",
    id: `toolu_${n}`,
  });
}

async function ledgerWith(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ledger-trim-"));
  const file = join(dir, "session.jsonl");
  const body = Array.from({ length: count }, (_, i) => line(i)).join("\n");
  await writeFile(file, `${body}\n`);
  return file;
}

describe("trimLedger", () => {
  test("leaves a file under the line cap untouched", async () => {
    const file = await ledgerWith(100);
    const before = await readFile(file, "utf8");
    await trimLedger(file);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  test("trims to LEDGER_TRIM_TO once the file crosses LEDGER_MAX_LINES", async () => {
    const file = await ledgerWith(LEDGER_MAX_LINES + 500);
    await trimLedger(file);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBe(LEDGER_TRIM_TO);
  });

  test("keeps the NEWEST lines, not the oldest", async () => {
    const total = LEDGER_MAX_LINES + 500;
    const file = await ledgerWith(total);
    await trimLedger(file);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    // Last line written must survive; the first must not.
    expect(lines.at(-1)).toBe(line(total - 1));
    expect(lines[0]).toBe(line(total - LEDGER_TRIM_TO));
    expect(lines).not.toContain(line(0));
  });

  test("output stays valid JSONL — every surviving line parses", async () => {
    const file = await ledgerWith(LEDGER_MAX_LINES + 500);
    await trimLedger(file);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  test("a second trim on an already-trimmed file is a no-op", async () => {
    const file = await ledgerWith(LEDGER_MAX_LINES + 500);
    await trimLedger(file);
    const once = await readFile(file, "utf8");
    await trimLedger(file);
    expect(await readFile(file, "utf8")).toBe(once);
  });

  test("missing file fails open rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-trim-"));
    await expect(trimLedger(join(dir, "does-not-exist.jsonl"))).resolves.toBeUndefined();
  });

  // The gate is an optimization, so the property that matters is that it is
  // never WRONG: any file genuinely over the line cap must still get trimmed.
  // A gate tuned too aggressively would silently stop trimming, and the only
  // symptom would be unbounded growth — invisible until a disk filled.
  test("size gate never skips a trim that was due, even with minimal lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-trim-"));
    const file = join(dir, "session.jsonl");
    // Smallest entry this module can actually emit (all three variants carry
    // `t` + `tool`), repeated past the cap — the worst case for a byte-based gate.
    const minimal = JSON.stringify({ t: T, kind: "read", path: "a", tool: "R" });
    const count = LEDGER_MAX_LINES + 10;
    await writeFile(file, `${Array.from({ length: count }, () => minimal).join("\n")}\n`);
    const { size } = await stat(file);
    // Guard the guard: if this ever drops below the gate the test would pass
    // vacuously, so assert the fixture really is above the threshold.
    expect(size).toBeGreaterThan(LEDGER_MAX_LINES * 40);
    await trimLedger(file);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBe(LEDGER_TRIM_TO);
  });

  test("appendEntries trims through to the same cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-append-"));
    const sessionId = "sess-trim-1";
    const file = join(dir, `${sessionId}.jsonl`);
    const body = Array.from({ length: LEDGER_MAX_LINES + 100 }, (_, i) => line(i)).join("\n");
    await writeFile(file, `${body}\n`);
    const entry: LedgerEntry = { t: T, kind: "change", path: "src/new.ts", tool: "Write" };
    await appendEntries(sessionId, [entry], dir);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBe(LEDGER_TRIM_TO);
    // The just-appended entry is the newest and must be the one kept.
    expect(JSON.parse(lines.at(-1) as string).path).toBe("src/new.ts");
  });
});
