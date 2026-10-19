import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COPILOT_MARKERS, syncCopilotInstructions } from "../src/lib/copilot-instructions.ts";

const roots: string[] = [];

async function setup(opts: { copilot: boolean; agents?: string; existing?: string }) {
  const root = await mkdtemp(join(tmpdir(), "cc-copilot-"));
  roots.push(root);
  const claudeDir = join(root, ".claude");
  const home = join(root, ".copilot");
  await mkdir(claudeDir, { recursive: true });
  if (opts.agents !== undefined) await writeFile(join(claudeDir, "AGENTS.md"), opts.agents);
  if (opts.copilot) await mkdir(home, { recursive: true });
  const target = join(home, "copilot-instructions.md");
  if (opts.existing !== undefined) await writeFile(target, opts.existing);
  return { claudeDir, home, target };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("syncCopilotInstructions", () => {
  test("skips when Copilot CLI has no config dir", async () => {
    const { claudeDir, home } = await setup({ copilot: false, agents: "# Standards\n" });
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("skipped");
    expect(existsSync(home)).toBe(false);
  });

  test("writes the AGENTS.md block into an empty config dir", async () => {
    const { claudeDir, home, target } = await setup({ copilot: true, agents: "# Standards\n" });
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("written");
    const text = await readFile(target, "utf8");
    expect(text.startsWith(COPILOT_MARKERS.start)).toBe(true);
    expect(text).toContain("# Standards");
    expect(text.trimEnd().endsWith(COPILOT_MARKERS.end)).toBe(true);
  });

  test("keeps the user's own instructions around the block and is idempotent", async () => {
    const mine = "# My notes\nUse tabs.\n";
    const { claudeDir, home, target } = await setup({
      copilot: true,
      agents: "# Standards v1\n",
      existing: mine,
    });
    await syncCopilotInstructions(claudeDir, home);
    await writeFile(join(claudeDir, "AGENTS.md"), "# Standards v2\n");
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("written");
    const once = await readFile(target, "utf8");
    expect(once.startsWith(mine)).toBe(true);
    expect(once).toContain("# Standards v2");
    expect(once).not.toContain("# Standards v1");
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("unchanged");
    expect(await readFile(target, "utf8")).toBe(once);
  });

  test("removes only the block when AGENTS.md is gone", async () => {
    const mine = "# My notes\nUse tabs.\n";
    const { claudeDir, home, target } = await setup({
      copilot: true,
      agents: "# Standards\n",
      existing: mine,
    });
    await syncCopilotInstructions(claudeDir, home);
    await rm(join(claudeDir, "AGENTS.md"));
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("removed");
    expect(await readFile(target, "utf8")).toBe(mine);
  });

  test("deletes the file when the block was its only content", async () => {
    const { claudeDir, home, target } = await setup({ copilot: true, agents: "# Standards\n" });
    await syncCopilotInstructions(claudeDir, home);
    await rm(join(claudeDir, "AGENTS.md"));
    expect(await syncCopilotInstructions(claudeDir, home)).toBe("removed");
    expect(existsSync(target)).toBe(false);
  });

  test("refuses to touch a file with broken markers", async () => {
    const broken = `# Mine\n${COPILOT_MARKERS.start}\nhalf a block\n`;
    const { claudeDir, home, target } = await setup({
      copilot: true,
      agents: "# Standards\n",
      existing: broken,
    });
    await expect(syncCopilotInstructions(claudeDir, home)).rejects.toThrow("marker topology");
    expect(await readFile(target, "utf8")).toBe(broken);
  });
});
