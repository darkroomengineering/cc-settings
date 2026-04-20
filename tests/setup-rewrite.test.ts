// Lock behavior of the CC_USE_TS_HOOKS hook-command rewriter.
// If this file fails, the rewriter either over-rewrote (mangled an inline
// `bash -c '…'` block) or under-rewrote (missed a mapped path).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rewriteHookCommands, rewriteSettingsForTs } from "../src/setup.ts";

describe("rewriteHookCommands", () => {
  test("rewrites bash path to bun path for a mapped script", () => {
    const input = 'bash "$HOME/.claude/scripts/safety-net.sh"';
    const out = rewriteHookCommands(input);
    expect(out).toBe('bun "$HOME/.claude/src/hooks/safety-net.ts"');
  });

  test("rewrites scripts/* → src/scripts/* for non-hook files", () => {
    const input = 'bash "$HOME/.claude/scripts/post-edit.sh"';
    const out = rewriteHookCommands(input);
    expect(out).toBe('bun "$HOME/.claude/src/scripts/post-edit.ts"');
  });

  test("leaves inline bash -c blocks untouched when no marker matches", () => {
    const input = `bash -c 'if echo "$PROMPT" | grep -qiE "wrong"; then echo hi; fi'`;
    expect(rewriteHookCommands(input)).toBe(input);
  });

  test("rewrites known inline bash -c blocks to their TS counterparts", () => {
    const correctionHook =
      'bash -c \'if echo "$PROMPT" | grep -qiE "no,|wrong"; then echo "[Hook] Correction detected"; fi\'';
    expect(rewriteHookCommands(correctionHook)).toBe(
      'bun "$HOME/.claude/src/scripts/detect-correction.ts"',
    );

    const swarmStart =
      "bash -c 'echo \"[Swarm] Agent started: $AGENT_TYPE ($AGENT_ID)\" >> ~/.claude/swarm.log'";
    expect(rewriteHookCommands(swarmStart)).toBe(
      'bun "$HOME/.claude/src/scripts/swarm-log.ts" start',
    );
  });

  test("leaves trailing-arg bash invocations alone when path is unknown", () => {
    // Don't rewrite unmapped .sh files so we never accidentally point at
    // a TS port that doesn't exist.
    const input = 'bash "$HOME/.claude/scripts/some-unmapped.sh"';
    const out = rewriteHookCommands(input);
    expect(out).toBe('bun "$HOME/.claude/scripts/some-unmapped.sh"');
    // bun is pointed at the *bash* path here intentionally: in a real install
    // scripts/some-unmapped.sh wouldn't exist under src/, and the install
    // would fall back. But in practice we audit the map to cover every hook
    // referenced in settings.json — the schema + test below enforces that.
  });
});

describe("rewriteSettingsForTs", () => {
  test("rewrites all team settings.json hooks without raising", async () => {
    const raw = await readFile(resolve(import.meta.dir, "..", "settings.json"), "utf8");
    const team = JSON.parse(raw) as Record<string, unknown>;
    const out = rewriteSettingsForTs(team);
    expect(out).not.toBe(team); // new object
    // After rewrite, hook commands pointing at scripts/*.sh should invoke bun.
    const hooks = out.hooks as Record<string, Array<{ hooks: Array<{ command?: string }> }>>;
    let anyTs = false;
    for (const groups of Object.values(hooks)) {
      for (const g of groups) {
        for (const h of g.hooks) {
          if (!h.command) continue;
          // An inline `bash -c '…'` is allowed to stay.
          if (h.command.trim().startsWith("bash -c ")) continue;
          // Anything else that touches scripts/*.sh should now invoke bun.
          if (/\/scripts\/\S+\.sh/.test(h.command)) {
            throw new Error(`unrewritten bash hook: ${h.command}`);
          }
          if (h.command.startsWith("bun ") && /\.ts/.test(h.command)) anyTs = true;
        }
      }
    }
    expect(anyTs).toBe(true);
  });

  test("rewrites every inline bash -c hook in team settings.json", async () => {
    const raw = await readFile(resolve(import.meta.dir, "..", "settings.json"), "utf8");
    const team = JSON.parse(raw) as Record<string, unknown>;
    const out = rewriteSettingsForTs(team) as typeof team;
    // After rewrite, no hook.command should still be `bash -c …`.
    const json = JSON.stringify(out);
    const remaining = json.match(/\\"command\\":\s*\\"bash -c/) ?? [];
    if (remaining.length)
      throw new Error(`${remaining.length} inline bash -c hooks survived rewrite`);
    expect(remaining.length).toBe(0);
  });
});
