// Plugin/marketplace manifest contract: keeps .claude-plugin/ in sync with the
// rest of the repo so the Cowork-installable surface can't drift silently.
//
// - Every version-bearing file must match the installer VERSION in src/setup.ts,
//   which is the single source of truth (see CHANGELOG's Versioning note). Three
//   places carry it: plugin.json, package.json, and the CHANGELOG's top heading.
//   Each has drifted at least once — plugin.json sat at 8.1.0 for two major
//   versions, and package.json sat at 13.4.3 across three releases because
//   nothing tested it.
// - plugin.json mcpServers must be a subset of config/20-mcp.json (source of
//   truth), matching on the portable transport fields.
// - marketplace.json must point at the plugin defined in this repo.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const VERSION_CONST_RE = /\bconst VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/;

interface McpServerConfig {
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  [key: string]: unknown;
}

async function readJson(relPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(ROOT, relPath), "utf8"));
}

/** The one source of truth every other version must follow. */
async function installerVersion(): Promise<string> {
  const setup = await readFile(join(ROOT, "src/setup.ts"), "utf8");
  const match = setup.match(VERSION_CONST_RE);
  expect(match?.[1], 'src/setup.ts has no `const VERSION = "x.y.z"`').toBeDefined();
  return match?.[1] as string;
}

describe("version sync — every version-bearing file tracks src/setup.ts", () => {
  test("plugin.json version matches src/setup.ts VERSION", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    expect(plugin.version).toBe(await installerVersion());
  });

  test("package.json version matches src/setup.ts VERSION", async () => {
    const pkg = await readJson("package.json");
    expect(pkg.version).toBe(await installerVersion());
  });

  test("CHANGELOG's newest entry matches src/setup.ts VERSION", async () => {
    const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");
    // First `## [x.y.z]` heading in the file — entries are newest-first.
    const newest = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
    expect(newest?.[1], "CHANGELOG.md has no `## [x.y.z]` entry").toBeDefined();
    expect(newest?.[1]).toBe(await installerVersion());
  });
});

describe("plugin manifest — mcpServers sync with config/20-mcp.json", () => {
  test("every plugin server matches its config fragment counterpart", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    const fragment = await readJson("config/20-mcp.json");
    const pluginServers = (plugin.mcpServers ?? {}) as Record<string, McpServerConfig>;
    const configServers = (fragment.mcpServers ?? {}) as Record<string, McpServerConfig>;

    expect(Object.keys(pluginServers).length).toBeGreaterThan(0);

    for (const [name, server] of Object.entries(pluginServers)) {
      const source = configServers[name];
      expect(source, `plugin server "${name}" missing from config/20-mcp.json`).toBeDefined();
      if (!source) continue;
      expect(server.command).toBe(source.command as string | undefined);
      expect(server.args).toEqual(source.args as string[] | undefined);
      expect(server.type).toBe(source.type as string | undefined);
      expect(server.url).toBe(source.url as string | undefined);
    }
  });

  test("plugin servers carry only documented plugin-manifest fields", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    const pluginServers = (plugin.mcpServers ?? {}) as Record<string, McpServerConfig>;
    const allowed = new Set(["command", "args", "env", "cwd", "type", "url", "headers"]);
    for (const [name, server] of Object.entries(pluginServers)) {
      for (const key of Object.keys(server)) {
        expect(allowed.has(key), `plugin server "${name}" has non-portable field "${key}"`).toBe(
          true,
        );
      }
    }
  });
});

describe("marketplace manifest", () => {
  test("self-referential plugin entry matches plugin.json", async () => {
    const marketplace = await readJson(".claude-plugin/marketplace.json");
    const plugin = await readJson(".claude-plugin/plugin.json");

    expect(marketplace.name).toBe("cc-settings");
    expect((marketplace.owner as { name?: string })?.name).toBeTruthy();

    const entries = marketplace.plugins as Array<{ name: string; source: unknown }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe(plugin.name as string);
    expect(entries[0]?.source).toBe("./");
  });
});
