// Nuclear-review as a dynamic workflow — OPT-IN EXAMPLE, not a dependency.
//
// The nuclear-review skill (SKILL.md) is the canonical, always-available form
// and depends on nothing. This script is for when you want the same audit as a
// resumable, parallel workflow: phase state lives outside the context window,
// modules review concurrently (up to 16), and a re-run resumes from cached
// agent results. It uses the preview-stage Workflow tool API on purpose — that
// is exactly why it lives here as an example rather than wired into the skill.
//
// Run it (needs Claude Code >= 2.1.154 and the Workflow tool):
//   Workflow({ scriptPath: "~/.claude/skills/nuclear-review/references/nuclear-review.workflow.js",
//              args: { project: "." } })
// or copy it into .claude/workflows/ and invoke by name. `/effort ultracode`
// will also auto-orchestrate a comparable workflow without this file.

export const meta = {
  name: "nuclear-review",
  description:
    "Whole-codebase maintainability audit — map, fan out one structural reviewer per module, audit dependencies, synthesize one prioritized report.",
  whenToUse:
    "Periodic deep code-quality audit of an entire repo (not a single diff): major version cuts, after velocity sprints, before load-bearing migrations.",
  phases: [
    { title: "Map", detail: "enumerate modules + large files + dep count" },
    { title: "Review", detail: "one structural reviewer per module (parallel)" },
    { title: "Deps", detail: "dependency currency + usage audit via context7" },
    { title: "Synthesize", detail: "merge into one prioritized report" },
  ],
};

const PROJECT = (args && args.project) || ".";

const MODULE_FINDINGS = {
  type: "object",
  additionalProperties: false,
  required: ["module", "verdict", "findings"],
  properties: {
    module: { type: "string" },
    verdict: { type: "string", enum: ["CLEAN", "NEEDS_RESTRUCTURING", "NEEDS_MAJOR_REWORK"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "evidence"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["code-judo", "structural", "abstraction", "note"] },
          evidence: { type: "string", description: "file:line citation" },
        },
      },
    },
  },
};

phase("Map");
const map = await agent(
  `Read-only. Map the codebase at ${PROJECT} for a maintainability audit. Return: the top-level source ` +
    `modules worth reviewing as independent units (5-10), each with its rough responsibility; the largest ` +
    `source files (path + line count, flag any over 1000 lines); and the count of direct dependencies from ` +
    `the manifest. Skip vendored/generated/node_modules.`,
  {
    phase: "Map",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["modules", "largeFiles", "depCount"],
      properties: {
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "role"],
            properties: { path: { type: "string" }, role: { type: "string" } },
          },
        },
        largeFiles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "lines"],
            properties: { path: { type: "string" }, lines: { type: "number" } },
          },
        },
        depCount: { type: "number" },
      },
    },
  },
);

const modules = (map.modules || []).slice(0, 10);

const RUBRIC =
  `Apply the nuclear-review rubric: be ambitious about structural simplification (look for code-judo moves ` +
  `that delete whole branches, not just polish); flag files over 1000 lines; no spaghetti special-casing in ` +
  `shared flows; no thin/identity wrappers; no casts/any/unknown papering over invariants; logic in the right ` +
  `layer; flag avoidable sequential orchestration. Cite file:line. Prefer few high-conviction findings.`;

phase("Review");
const reviews = await parallel(
  modules.map((m) => () =>
    agent(
      `Read-only structural audit of module "${m.path}" (${m.role}) in ${PROJECT}. ${RUBRIC} ` +
        `Return a verdict + findings for THIS module only.`,
      { label: `review:${m.path}`, phase: "Review", schema: MODULE_FINDINGS },
    ),
  ),
);

phase("Deps");
const deps = await agent(
  `Read-only dependency audit of ${PROJECT}. For each direct dependency: is it within one major of current? ` +
    `Any deprecated/superseded usage patterns? Any two deps covering the same role? Any replaceable by a ` +
    `platform built-in? Use context7 (resolve-library-id then query-docs) for the highest-surface deps; cap ` +
    `3 context7 calls per dep, batch the top 10-20. Report current → recommended versions with reasons.`,
  { phase: "Deps" },
);

phase("Synthesize");
const payload = JSON.stringify({ map, reviews: reviews.filter(Boolean), deps }, null, 2);
const report = await agent(
  `Synthesize ONE nuclear-review report from the module reviews + dependency audit below, in the skill's ` +
    `output format: Verdict (CLEAN / NEEDS RESTRUCTURING / NEEDS MAJOR REWORK), Code-Judo Opportunities, ` +
    `Structural Blockers (files over 1k, spaghetti, boundary leaks), Dependency Audit, Abstraction/Type ` +
    `Cleanup, Notes. Prioritize ruthlessly — a few high-conviction findings beat a long list. Be faithful to ` +
    `the evidence; cite files.\n\n${payload}`,
  { phase: "Synthesize" },
);

return report;
