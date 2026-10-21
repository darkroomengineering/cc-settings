// Blocking rules for src/scripts/eval-changed.ts, kept free of the paid runner
// so tests can feed them fixed results. A single run is noisy, so the critical
// rule only fires on a case that passed every base run; paired statistical
// tests (McNemar, bootstrap CIs) are left out because at 1-3 runs per case
// they cannot reach significance.

import { z } from "zod";

export const CRITICAL_TAG = "critical";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real date");

export const QuarantineEntry = z.strictObject({
  case: z.string().min(1),
  owner: z.string().min(1),
  expires: isoDate,
  reason: z.string().min(1),
});
export type QuarantineEntry = z.infer<typeof QuarantineEntry>;

export const QuarantineFile = z.array(QuarantineEntry);

export interface Quarantine {
  /** Unexpired entries by case name. */
  active: Map<string, QuarantineEntry>;
  /** Malformed or expired entries. Each one blocks. */
  problems: string[];
}

/**
 * Validate the quarantine list. An entry is in force through its `expires`
 * date and expired the day after; `today` is YYYY-MM-DD.
 */
export function parseQuarantine(raw: unknown, today: string): Quarantine {
  const parsed = QuarantineFile.safeParse(raw);
  if (!parsed.success) {
    return {
      active: new Map(),
      problems: parsed.error.issues.map(
        (i) => `malformed quarantine entry at [${i.path.join(".")}]: ${i.message}`,
      ),
    };
  }
  const active = new Map<string, QuarantineEntry>();
  const problems: string[] = [];
  for (const entry of parsed.data) {
    if (entry.expires < today) {
      problems.push(
        `quarantine for ${entry.case} (owner ${entry.owner}) expired ${entry.expires}: ` +
          "fix the case or renew the entry",
      );
    } else if (active.has(entry.case)) {
      problems.push(`duplicate quarantine entry for ${entry.case}`);
    } else {
      active.set(entry.case, entry);
    }
  }
  return { active, problems };
}

export type GateRule = "below-threshold" | "critical-regression" | "missing-case";

export interface Verdict {
  case: string;
  rule: GateRule;
  detail: string;
  quarantined: boolean;
}

export interface CaseRuns {
  /** The runner's aggregate score for the case. */
  score: number;
  /** Per-run scores of the graded runs. */
  runs: number[];
}

export interface GateInput {
  candidate: Map<string, CaseRuns>;
  /** Base-arm results, or null when no base arm ran. */
  base: Map<string, CaseRuns> | null;
  critical: Set<string>;
  /** Cases tagged with a changed skill at the merge-base that the branch no longer has. */
  removed: string[];
  quarantine: Map<string, QuarantineEntry>;
  threshold: number;
}

export function gate(input: GateInput): Verdict[] {
  const verdicts: Verdict[] = [];
  const add = (name: string, rule: GateRule, detail: string) =>
    verdicts.push({ case: name, rule, detail, quarantined: input.quarantine.has(name) });

  for (const [name, now] of input.candidate) {
    if (now.score < input.threshold) {
      add(name, "below-threshold", `scored ${now.score.toFixed(2)} < ${input.threshold}`);
    }
    const was = input.base?.get(name);
    if (!input.critical.has(name) || !was || was.runs.length === 0 || now.runs.length === 0) {
      continue;
    }
    const passedEveryBase = was.runs.every((s) => s >= input.threshold);
    const failedRuns = now.runs.filter((s) => s < input.threshold).length;
    if (passedEveryBase && failedRuns > 0) {
      add(
        name,
        "critical-regression",
        `passed ${was.runs.length}/${was.runs.length} base runs, failed ${failedRuns}/${now.runs.length} candidate runs`,
      );
    }
  }
  for (const name of input.removed) {
    add(name, "missing-case", "present at the merge-base, missing from the branch");
  }
  return verdicts;
}

/**
 * Cases that carried a changed skill's tag at the merge-base and either no
 * longer exist or no longer carry that tag. Skills outside `changed` are never
 * checked, so untouched skills cannot trip this.
 */
export function removedCases(
  baseCases: Iterable<[string, string[]]>,
  currentCases: Map<string, string[]>,
  changed: Set<string>,
): string[] {
  const removed: string[] = [];
  for (const [name, tags] of baseCases) {
    const lost = tags.filter((t) => changed.has(t) && !currentCases.get(name)?.includes(t));
    if (lost.length > 0) removed.push(name);
  }
  return removed.sort();
}
