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

// Advisory probes run alongside the hard gates but never flip the verdict.
export type ProbeName = GateName | "react-doctor";

export interface GateResult {
  gate: ProbeName;
  status: "pass" | "fail" | "skip";
  detail?: string;
  // Advisory probes (e.g. react-doctor) report a signal for the reviewer but are
  // never blocking — a low score is information, not a failing gate.
  advisory?: boolean;
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

/** react-doctor is an OPTIONAL advisory probe for React projects. We run it only
 *  when the project already depends on it — that way local `npx` resolves the
 *  lockfile-pinned binary from `node_modules/.bin` with no network fetch, so the
 *  gate never pulls an unpinned `@latest` (cc-settings supply-chain posture).
 *  Silently absent for non-React projects, and for React projects that haven't
 *  opted in by adding the dependency. Pass the merged deps + devDeps map. */
export function detectReactDoctor(deps: Record<string, string>): boolean {
  return "react-doctor" in deps;
}

/** Overall verdict: green iff no NON-ADVISORY gate FAILED. Skips are allowed (a
 *  project without a lint script isn't "not review-ready"), and advisory probes
 *  never block regardless of their status. */
export function allGreen(results: GateResult[]): boolean {
  return results.every((r) => r.advisory || r.status !== "fail");
}

export function formatReport(results: GateResult[]): string {
  const icon: Record<GateResult["status"], string> = { pass: "✓", fail: "✗", skip: "−" };
  const lines = results.map((r) => {
    const mark = r.advisory ? "ℹ" : icon[r.status];
    const suffix = r.advisory ? " (advisory)" : "";
    return `  ${mark} ${r.gate}${r.detail ? ` — ${r.detail}` : ""}${suffix}`;
  });
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

/** Run the react-doctor advisory probe. Uses local `npx` (resolves the project's
 *  pinned binary — never `@latest`), scores the project, and forces telemetry
 *  off. Always advisory: any non-zero exit or unparseable output is a SKIP, not
 *  a fail, so a missing/broken react-doctor can never block review. */
export async function runReactDoctor(cwd: string): Promise<GateResult> {
  const proc = Bun.spawn(["npx", "react-doctor", "--score", "--no-telemetry"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [out, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const score = out.match(/\d{1,3}/)?.[0];
  if (exit !== 0 || !score) {
    return { gate: "react-doctor", status: "skip", detail: "unavailable", advisory: true };
  }
  return { gate: "react-doctor", status: "pass", detail: `score ${score}/100`, advisory: true };
}
