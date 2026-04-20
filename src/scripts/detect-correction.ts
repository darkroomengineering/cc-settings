#!/usr/bin/env bun
// UserPromptSubmit hook: hint the user to capture corrections as learnings.
// Extracted from the inline `bash -c '…'` in settings.json — Phase 6.2.

const userPrompt = process.env.PROMPT ?? "";
const triggers = /\b(no,|wrong|actually,|instead|fix that|not what|should be|correction)\b/i;
if (triggers.test(userPrompt)) {
  console.log("[Hook] Correction detected - consider capturing this as a learning with /learn");
}

export {};
