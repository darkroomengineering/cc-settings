// Compose ~/.claude/settings.json from numbered fragments in config/.
//
// Fragments are authored independently (hooks changes don't churn permissions
// diffs, etc.). They're merged alphabetically by filename, top-level keys from
// later files overriding earlier ones on conflict. Intended layout:
//
//   config/10-core.json          — $schema, env, sandbox, model, scalars, statusLine
//   config/20-mcp.json           — mcpServers
//   config/30-permissions.json   — permissions
//   config/40-hooks.json         — hooks
//
// Keep fragments disjoint on top-level keys to keep precedence simple.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function composeSettings(sourceDir: string): Promise<Record<string, unknown>> {
  const configDir = join(sourceDir, "config");
  if (!existsSync(configDir)) {
    throw new Error(`config/ not found in ${sourceDir}`);
  }
  const fragments = (await readdir(configDir)).filter((f) => f.endsWith(".json")).sort();
  if (fragments.length === 0) {
    throw new Error(`config/ contains no .json fragments in ${sourceDir}`);
  }

  const merged: Record<string, unknown> = {};
  for (const f of fragments) {
    const text = await readFile(join(configDir, f), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`config/${f} is not valid JSON: ${(err as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`config/${f} must be a JSON object at the top level`);
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      merged[k] = v;
    }
  }
  return merged;
}
