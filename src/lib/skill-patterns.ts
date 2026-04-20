// Skill-to-pattern map — port of lib/skill-patterns.sh.
//
// Hot path: consumed by scripts/compile-skills + scripts/skill-activation on
// every UserPromptSubmit. A `Record` lookup replaces the bash case/grep chain
// — O(1) instead of O(n_skills).

export type SkillPriority = "critical" | "high" | "medium" | "low";
export type SkillEnforcement = "block" | "recommend" | "suggest";

export interface SkillDef {
  patterns: string[];
  agents: string[];
  priority: SkillPriority;
  enforcement: SkillEnforcement;
}

// Priority + enforcement rules from the bash version.
const CRITICAL = new Set(["create-handoff", "resume-handoff"]);
const HIGH = new Set(["fix", "build", "refactor", "review", "orchestrate", "ship"]);
const MEDIUM = new Set([
  "explore",
  "test",
  "component",
  "hook",
  "learn",
  "tldr",
  "prd",
  "f-thread",
  "l-thread",
  "project",
  "lighthouse",
]);

function priorityOf(name: string): SkillPriority {
  if (CRITICAL.has(name)) return "critical";
  if (HIGH.has(name)) return "high";
  if (MEDIUM.has(name)) return "medium";
  return "low";
}

const BLOCK = new Set(["create-handoff"]);
const RECOMMEND = new Set(["fix", "build", "refactor", "review", "ship"]);

function enforcementOf(name: string): SkillEnforcement {
  if (BLOCK.has(name)) return "block";
  if (RECOMMEND.has(name)) return "recommend";
  return "suggest";
}

const AGENTS: Record<string, string[]> = {
  fix: ["explore", "implementer", "tester"],
  build: ["planner", "scaffolder", "implementer"],
  explore: ["explore", "oracle"],
  review: ["reviewer", "tester"],
  refactor: ["explore", "implementer", "reviewer"],
  test: ["tester"],
  orchestrate: ["maestro"],
  component: ["scaffolder"],
  hook: ["scaffolder"],
  ship: ["tester", "reviewer", "implementer"],
  premortem: ["oracle", "reviewer"],
  ask: ["oracle", "reviewer"],
  tldr: ["explore"],
  teams: ["maestro"],
  "f-thread": ["oracle"],
  "l-thread": ["planner", "implementer"],
  prd: ["planner"],
  "design-tokens": ["scaffolder"],
  lighthouse: ["implementer"],
  verify: ["reviewer"],
};

const PATTERNS: Record<string, string[]> = {
  fix: ["fix", "bug", "broken", "error", "failing", "not working", "issue"],
  build: ["build", "create", "implement", "add feature", "new feature", "add new"],
  explore: [
    "explore",
    "how does",
    "where is",
    "find",
    "understand",
    "what files",
    "navigate",
    "how.*work",
  ],
  review: ["review", "check", "look at", "pr", "pull request", "code review", "diff"],
  test: ["write tests", "add tests", "run tests", "coverage", "unit test", "integration test"],
  refactor: ["refactor", "clean up", "reorganize", "restructure", "improve code", "technical debt"],
  component: ["create component", "new component", "add component", "/component"],
  hook: ["create hook", "new hook", "add hook", "/hook"],
  orchestrate: ["orchestrate", "coordinate", "complex task", "multi-step", "/orchestrate"],
  "create-handoff": [
    "done.*today",
    "ending.*session",
    "save session",
    "create.*handoff",
    "handoff.sh create",
    "wrapping up",
    "pause work",
    "context full",
  ],
  "resume-handoff": [
    "resume",
    "continue where",
    "pick up",
    "resume.*handoff",
    "handoff.sh resume",
    "last session",
    "previous work",
  ],
  learn: [
    "remember.*this",
    "store.*learning",
    "recall.*learning",
    "what.*learned",
    "lessons learned",
    "learning.sh",
    "/learn",
  ],
  tldr: [
    "who calls",
    "what affects",
    "trace",
    "dependencies",
    "semantic search",
    "call graph",
    "/tldr",
  ],
  premortem: ["what could.*wrong", "risks", "potential issues", "fail", "break"],
  docs: ["/docs", "documentation", "api reference", "library docs"],
  debug: ["/debug", "debug", "screenshot", "inspect element", "visual bug"],
  qa: ["/qa", "visual qa", "accessibility check", "a11y"],
  init: ["/init", "initialize project", "setup project"],
  ask: ["/ask", "oracle", "expert advice", "guidance"],
  lenis: ["/lenis", "smooth scroll", "lenis", "smooth scrolling"],
  versions: ["/versions", "package versions", "check versions", "darkroom packages"],
  context: ["/context", "context window", "context usage", "token usage"],
  discovery: ["/discovery", "discover", "find features", "what can you do"],
  teams: [
    "use teams",
    "fan out",
    "split work",
    "parallel agents",
    "divide and conquer",
    "multi-instance",
    "agent teams",
  ],
  ship: [
    "ship",
    "ship it",
    "create pr",
    "open pr",
    "/pr",
    "/ship",
    "ready to merge",
    "push and pr",
    "ready to ship",
  ],
  checkpoint: [
    "checkpoint",
    "save state",
    "save progress",
    "restore checkpoint",
    "list checkpoints",
    "/checkpoint",
  ],
  "design-tokens": [
    "design tokens",
    "type scale",
    "color palette",
    "spacing system",
    "theme setup",
    "design system",
    "color scale",
    "/design-tokens",
  ],
  "f-thread": [
    "compare approaches",
    "which is better",
    "evaluate options",
    "architecture decision",
    "technology selection",
    "trade-off analysis",
    "trade-off",
    "/f-thread",
  ],
  "l-thread": [
    "overnight",
    "long running",
    "autonomous task",
    "l-thread",
    "extended task",
    "/l-thread",
  ],
  prd: [
    "prd",
    "requirements document",
    "product spec",
    "feature spec",
    "write requirements",
    "/prd",
  ],
  project: [
    "what's the plan",
    "project status",
    "update the issue",
    "sync with github",
    "check the roadmap",
    "what am i working on",
    "show my tasks",
    "close the issue",
    "mark as done",
    "/project",
  ],
  figma: [
    "/figma",
    "figma",
    "compare to design",
    "design fidelity",
    "match the figma",
    "extract tokens from figma",
    "inspect in figma",
  ],
  lighthouse: [
    "lighthouse",
    "performance audit",
    "page speed",
    "web vitals",
    "core web vitals",
    "LCP",
    "CLS",
    "INP",
    "slow page",
    "/lighthouse",
  ],
  audit: ["audit commands", "audit bash", "analyze commands", "command history", "/audit"],
  consolidate: [
    "consolidate",
    "contradictions",
    "clean up rules",
    "settings review",
    "/consolidate",
    "spa day",
  ],
  verify: ["verify", "double check", "prove it", "adversarial review", "/verify"],
  autoresearch: [
    "autoresearch",
    "optimize skill",
    "improve skill",
    "tune skill",
    "evolve skill",
    "prompt optimization",
    "skill optimization",
    "/autoresearch",
  ],
};

/** Full skill-definition table. Keys are skill names. */
export const SKILL_DEFS: Record<string, SkillDef> = Object.freeze(
  Object.fromEntries(
    Object.keys(PATTERNS).map((name) => [
      name,
      {
        patterns: PATTERNS[name] ?? [],
        agents: AGENTS[name] ?? [],
        priority: priorityOf(name),
        enforcement: enforcementOf(name),
      } satisfies SkillDef,
    ]),
  ),
);

export function getSkillPatterns(name: string): string[] {
  return SKILL_DEFS[name]?.patterns ?? [];
}

export function getSkillAgents(name: string): string[] {
  return SKILL_DEFS[name]?.agents ?? [];
}

export function getSkillPriority(name: string): SkillPriority {
  return SKILL_DEFS[name]?.priority ?? priorityOf(name);
}

export function getSkillEnforcement(name: string): SkillEnforcement {
  return SKILL_DEFS[name]?.enforcement ?? enforcementOf(name);
}

/** Names of all known skills (defined patterns). */
export const KNOWN_SKILLS = Object.freeze(Object.keys(SKILL_DEFS));
