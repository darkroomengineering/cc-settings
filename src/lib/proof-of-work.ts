// Proof-of-work gate — the Amdahl-shrink move from the "Orchestration Tax".
//
// Human review is the serial bottleneck. The way to raise throughput isn't only
// to throttle agents (review-queue-nudge) — it's to shrink the serial fraction:
// make the machine prove the boring 80% (types, tests, lint) so the human lock
// is spent only on the 20% that needs judgment. A diff is "review-ready" when
// the verification battery is green; what a machine can verify shouldn't cost a
// human's attention.
//
// Pure detection/formatting (unit-tested) + the subprocess runner.

export type GateName = "typecheck" | "test" | "lint";

export interface GateResult {
  gate: GateName;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

// Each gate maps to the package.json script it runs.
const GATE_SCRIPTS: Record<GateName, string> = {
  typecheck: "typecheck",
  test: "test",
  lint: "lint",
};

/** Which gates are runnable, given the project's package.json scripts. Order is
 *  cheapest-failure-first (typecheck → test → lint). */
export function detectGates(scripts: Record<string, string>): GateName[] {
  return (["typecheck", "test", "lint"] as GateName[]).filter((g) => GATE_SCRIPTS[g] in scripts);
}

/** Overall verdict: green iff no gate FAILED (skips are allowed — a project
 *  without a lint script isn't "not review-ready"). */
export function allGreen(results: GateResult[]): boolean {
  return results.every((r) => r.status !== "fail");
}

export function formatReport(results: GateResult[]): string {
  const icon: Record<GateResult["status"], string> = { pass: "✓", fail: "✗", skip: "−" };
  const lines = results.map(
    (r) => `  ${icon[r.status]} ${r.gate}${r.detail ? ` — ${r.detail}` : ""}`,
  );
  const verdict = allGreen(results)
    ? "review-ready ✓ — machine-verifiable checks pass; spend review on judgment, not these"
    : "NOT review-ready ✗ — fix the failing gate(s) before this reaches a human";
  return ["Proof of work:", ...lines, "", verdict].join("\n");
}

/** Run one gate via `bun run <script>`; pass iff exit 0. */
export async function runGate(gate: GateName, cwd: string): Promise<GateResult> {
  const proc = Bun.spawn(["bun", "run", GATE_SCRIPTS[gate]], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  const exit = await proc.exited;
  return { gate, status: exit === 0 ? "pass" : "fail" };
}

/** Run gates sequentially — tsc / the test runner are CPU-heavy, so parallel
 *  execution would just thrash. Cheapest-failure-first ordering surfaces the
 *  fastest signal first. */
export async function runGates(gates: GateName[], cwd: string): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const g of gates) results.push(await runGate(g, cwd));
  return results;
}
