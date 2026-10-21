#!/usr/bin/env bun
// `bun grade-findings.ts <findings.jsonl>`: the /audit grounding check. Reads one
// finding per line ({id, status, ...}), scores each for grounding (file:line),
// evidence (numbers with units), hedge words and actionability, and relabels a
// CONFIRMED finding with no file:line to PLAUSIBLE. Only that rule changes a
// label; the scores are reported. Other statuses (Performance's "measured")
// pass through. Prints the graded findings as JSON lines; exit 1 on bad input.

import { z } from "zod";

const FindingSchema = z.object({ id: z.string().min(1), status: z.string().min(1) }).passthrough();
export type Finding = z.infer<typeof FindingSchema>;

const FILE_LINE = /[\w/.\-@[\]()]+\.\w+:\d+/g;
const UNIT =
  /\b\d[\d.,]*\s*(?:%|ms|s|sec|seconds?|min|minutes?|h|hours?|GB|MB|KB|kB|B|bytes?|rps|qps|lines?|files?|calls?|requests?)(?![\w])/gi;
const HEDGE = /\b(?:might|may|could|possibly|perhaps|maybe|likely|probably|seems?|appears?)\b/gi;
const ACTION =
  /\b(?:delete|remove|replace|merge|move|extract|inline|rename|split|add|validate|guard|cache|parallelize|upgrade|pin|drop|wrap)\b/i;

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

export function gradeFinding(finding: Finding): Finding {
  const text = Object.entries(finding)
    .filter(([key, value]) => key !== "status" && typeof value === "string")
    .map(([, value]) => value)
    .join("\n");
  const grounded = count(text, FILE_LINE) > 0;
  const grade = {
    grounded,
    evidence: count(text, UNIT),
    hedges: count(text, HEDGE),
    actionable: ACTION.test(text),
  };
  if (finding.status === "CONFIRMED" && !grounded) {
    return {
      ...finding,
      status: "PLAUSIBLE",
      grade,
      downgrade:
        "CONFIRMED without file:line: nothing in the finding points at the lines that prove it",
    };
  }
  return { ...finding, grade };
}

export function gradeFindings(jsonl: string): Finding[] {
  return jsonl.split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1}: not valid JSON`);
    }
    const parsed = FindingSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(`line ${i + 1}: a finding needs a string "id" and "status"`);
    return [gradeFinding(parsed.data)];
  });
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun grade-findings.ts <findings.jsonl>");
    process.exit(1);
  }
  try {
    const graded = gradeFindings(await Bun.file(path).text());
    for (const finding of graded) console.log(JSON.stringify(finding));
    const downgraded = graded.filter((f) => f.downgrade).length;
    console.error(
      `[grade-findings] ${graded.length} findings, ${downgraded} downgraded to PLAUSIBLE`,
    );
  } catch (err) {
    console.error(`[grade-findings] ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
