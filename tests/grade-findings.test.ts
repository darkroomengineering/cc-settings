import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gradeFindings } from "../src/scripts/grade-findings.ts";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "grade-findings.ts");
const jsonl = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");

describe("gradeFindings", () => {
  test("grounded CONFIRMED stays CONFIRMED", () => {
    const [f] = gradeFindings(
      jsonl({
        id: "H1",
        status: "CONFIRMED",
        location: "src/api/user.ts:42",
        issue: "Remove the unvalidated redirect; it adds 300 ms per request",
      }),
    );
    expect(f?.status).toBe("CONFIRMED");
    expect(f?.downgrade).toBeUndefined();
    expect(f?.grade).toEqual({ grounded: true, evidence: 1, hedges: 0, actionable: true });
  });

  test("ungrounded CONFIRMED is downgraded to PLAUSIBLE with a reason", () => {
    const [f] = gradeFindings(
      jsonl({ id: "M1", status: "CONFIRMED", location: "src/api/", issue: "Auth might leak" }),
    );
    expect(f?.status).toBe("PLAUSIBLE");
    expect(String(f?.downgrade)).toContain("file:line");
    expect(f?.grade).toMatchObject({ grounded: false, hedges: 1 });
  });

  test("PLAUSIBLE and other statuses are never relabelled", () => {
    const graded = gradeFindings(
      jsonl(
        { id: "L1", status: "PLAUSIBLE", issue: "no location at all" },
        { id: "P1", status: "measured", issue: "LCP 4.2 s on /home" },
      ),
    );
    expect(graded.map((f) => f.status)).toEqual(["PLAUSIBLE", "measured"]);
    expect(graded.every((f) => f.downgrade === undefined)).toBe(true);
  });

  test("blank lines are skipped; extra fields pass through", () => {
    const [f] = gradeFindings(
      `\n${jsonl({ id: "H2", status: "PLAUSIBLE", severity: "high" })}\n\n`,
    );
    expect(f?.severity).toBe("high");
  });

  test("malformed input throws an error naming the line", () => {
    expect(() => gradeFindings(`${jsonl({ id: "H1", status: "CONFIRMED" })}\n{oops`)).toThrow(
      "line 2: not valid JSON",
    );
    expect(() => gradeFindings(jsonl({ id: "H1" }))).toThrow(
      'line 1: a finding needs a string "id"',
    );
  });
});

describe("grade-findings.ts CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "grade-findings-"));
  const run = (...args: string[]) =>
    Bun.spawnSync({ cmd: ["bun", SCRIPT, ...args], stdout: "pipe", stderr: "pipe" });

  test("prints graded JSON lines and a summary", () => {
    const file = join(dir, "ok.jsonl");
    writeFileSync(file, jsonl({ id: "M1", status: "CONFIRMED", issue: "no location" }));
    const r = run(file);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString()).status).toBe("PLAUSIBLE");
    expect(r.stderr.toString()).toContain("1 findings, 1 downgraded");
  });

  test("malformed input exits 1 with a clear error", () => {
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, "not json");
    const r = run(file);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("line 1: not valid JSON");
  });

  test("missing argument exits 1 with usage", () => {
    const r = run();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("usage:");
  });
});
