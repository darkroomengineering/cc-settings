#!/usr/bin/env bun
// UserPromptSubmit hook — detect breadth signals in the incoming prompt and report
// them before the model plans. It names the signal only; the delegation rule itself
// lives in CLAUDE.md and is already in context.
// Fail-open: any error → silent success (never block the prompt).

import { emitAdditionalContext, readHookInput, runHook } from "../lib/hook-runtime.ts";

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
  const payload = await readHookInput<{ prompt: string }>({ prompt: "PROMPT" });
  const prompt = payload.prompt ?? "";

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

  // Report the signal only. The delegation rule itself lives in CLAUDE.md and is
  // already in context — restating it here would be the same instruction twice.
  const msg =
    `Breadth signals in this prompt (score ${score}): ${reasons.join("; ")}. ` +
    `Apply the delegation heuristic.`;

  emitAdditionalContext("UserPromptSubmit", msg);
}

await runHook(main);
