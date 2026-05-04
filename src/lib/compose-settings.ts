// Compose ~/.claude/settings.json from numbered fragments in config/.
//
// Fragments are authored independently (hooks changes don't churn permissions
// diffs, etc.). They're sorted by their numeric prefix, then merged with
// top-level keys from later files overriding earlier ones on conflict.
// Intended layout:
//
//   config/10-core.json          — $schema, env, sandbox, model, scalars, statusLine
//   config/20-mcp.json           — mcpServers
//   config/30-permissions.json   — permissions
//   config/40-hooks.json         — hooks
//
// Keep fragments disjoint on top-level keys to keep precedence simple.
//
// Naming contract (enforced at compose time):
//   - Every fragment must be `<digits>-<name>.json`. Unprefixed fragments
//     are rejected — the prefix is the source of truth for ordering.
//   - Numeric prefixes must be unique. `10-foo.json` and `010-bar.json`
//     would collide on numeric value (both 10) and produce ambiguous
//     ordering; we reject at install rather than ship something that
//     depends on alphabetical resolution of the same number.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PREFIX_RE = /^(\d+)-/;

export async function composeSettings(sourceDir: string): Promise<Record<string, unknown>> {
  const configDir = join(sourceDir, "config");
  if (!existsSync(configDir)) {
    throw new Error(`config/ not found in ${sourceDir}`);
  }
  const fragments = (await readdir(configDir)).filter((f) => f.endsWith(".json"));
  if (fragments.length === 0) {
    throw new Error(`config/ contains no .json fragments in ${sourceDir}`);
  }

  // Validate the naming contract: every fragment has a numeric prefix; no
  // two fragments share a numeric value. Build the ordered list as we go.
  const seenPrefixes = new Map<number, string>();
  const ordered: Array<{ file: string; prefix: number }> = [];
  for (const f of fragments) {
    const match = PREFIX_RE.exec(f);
    if (!match) {
      throw new Error(
        `config/${f} has no numeric prefix — fragments must be named "<digits>-<name>.json"`,
      );
    }
    const prefix = Number.parseInt(match[1] ?? "", 10);
    const existing = seenPrefixes.get(prefix);
    if (existing) {
      throw new Error(
        `config/${f} collides with config/${existing} on numeric prefix ${prefix}. ` +
          "Pick a unique prefix.",
      );
    }
    seenPrefixes.set(prefix, f);
    ordered.push({ file: f, prefix });
  }
  ordered.sort((a, b) => a.prefix - b.prefix);

  const merged: Record<string, unknown> = {};
  for (const { file } of ordered) {
    const text = await readFile(join(configDir, file), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`config/${file} is not valid JSON: ${(err as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`config/${file} must be a JSON object at the top level`);
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      merged[k] = v;
    }
  }
  return merged;
}
