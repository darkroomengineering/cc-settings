#!/usr/bin/env bun
// UserPromptSubmit hook — detect breadth signals in the incoming prompt and
// prepend a system reminder pointing at Agent(maestro) before the model plans.
// Fail-open: any error → silent success (never block the prompt).

export {};

const BREADTH_PHRASES: RegExp[] = [
  /do all\b/i,
  /do everything\b/i,
  /execute\s+(the|that|this)?\s*plan/i,
  /now make it happen/i,
  /across the\s+(repo|codebase|repository|project)/i,
  /every\s+(file|skill|module|component)/i,
  /all of\s+(the|them|these|those)/i,
  /refactor\s+(the\s+)?(whole|entire|full)/i,
  /batch\s+(this|these|all)/i,
  /multi-file/i,
  /fan\s+out/i,
];

// Rough path-shaped token: "dir/file.ext" or "file.ext" forms
const PATH_TOKEN = /\b[\w-]+\/[\w./-]+|\b[\w-]+\.(ts|tsx|js|jsx|md|json|css|scss)\b/gi;

// List item: "- item", "* item", "1. item"
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/gm;

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  let prompt = "";
  try {
    const payload = JSON.parse(raw) as { prompt?: string };
    prompt = payload.prompt ?? process.env.PROMPT ?? "";
  } catch {
    prompt = process.env.PROMPT ?? "";
  }

  if (!prompt) return;

  let score = 0;
  const reasons: string[] = [];

  for (const rx of BREADTH_PHRASES) {
    const matches = prompt.match(rx);
    if (matches) {
      score += 2;
      reasons.push(`breadth phrase matched: "${matches[0] ?? ""}"`);
    }
  }

  const pathMatches = prompt.match(PATH_TOKEN) ?? [];
  if (pathMatches.length >= 3) {
    score += 1;
    reasons.push(`${pathMatches.length} path-shaped tokens found`);
  }

  const listMatches = prompt.match(LIST_ITEM) ?? [];
  if (listMatches.length >= 4) {
    score += 1;
    reasons.push(`${listMatches.length} list items found`);
  }

  if (score < 2) return;

  const reasonList = reasons.map((r) => `  • ${r}`).join("\n");
  const msg =
    `Breadth signals detected in this prompt (score ${score}):\n${reasonList}\n\n` +
    `This prompt likely spans multiple files or requires parallel workstreams. ` +
    `Per CLAUDE.md delegation rules: use Agent(maestro) for full-feature orchestration, ` +
    `Agent(implementer) for multi-file implementation, or spawn multiple parallel agents ` +
    `in a SINGLE message. Do not self-execute tasks that trigger the 3+ file or 10+ tool-call thresholds.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: msg,
      },
    }),
  );
}

try {
  await main();
} catch {
  // Fail open — never block a user prompt due to hook failure.
}
