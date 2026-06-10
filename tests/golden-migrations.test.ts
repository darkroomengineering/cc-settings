// Golden migration fixtures. Each subdirectory under tests/fixtures/migrations/
// is one scenario:
//
//   <scenario>/
//     team-settings.json   — what cc-settings ships
//     user-settings.json   — what the user has on disk
//     expected.json        — what the merged output must look like
//
// The runner loads all three, runs mergeSettingsWithMcpPreservation,
// deep-equals against expected.json. Failures show a diff so it's clear
// which key drifted.
//
// Why fixtures and not pure unit tests: the file-based snapshots are easy
// to read as "this was the pre-v10 state, this is what it should become",
// they catch accidental output drift (e.g. someone reorders the strategy
// loop and changes key emission order), and they exercise the full merger
// path for the scenarios that motivated v10.3.2 + v10.4.1.

import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeSettingsWithMcpPreservation } from "../src/lib/settings-merge.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures", "migrations");

// Sync read at module init — `describe` callbacks aren't async. The fixture
// list is small and lives in the test tree, so sync IO is fine here.
const SCENARIOS = readdirSync(FIXTURES).filter((name) =>
  statSync(join(FIXTURES, name)).isDirectory(),
);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("golden migration fixtures", () => {
  test("at least one fixture exists", () => {
    expect(SCENARIOS.length).toBeGreaterThan(0);
  });

  test.each(SCENARIOS)("%s", async (scenario) => {
    const scenarioDir = join(FIXTURES, scenario);
    const teamPath = join(scenarioDir, "team-settings.json");
    const userInputPath = join(scenarioDir, "user-settings.json");
    const expectedPath = join(scenarioDir, "expected.json");

    // Sandbox: copy the fixture's user-settings into a tmp dir, point the
    // merger at it, write to a fresh output. Don't mutate the fixture.
    // Team settings are passed in-memory — the merger takes the composed
    // object, not a path (the staged-file indirection was removed).
    const sandbox = await mkdtemp(join(tmpdir(), `cc-golden-${scenario}-`));
    try {
      const userPath = join(sandbox, "user-settings.json");
      const outPath = join(sandbox, "merged.json");
      await writeFile(userPath, await readFile(userInputPath, "utf8"));
      const team = (await readJson(teamPath)) as Record<string, unknown>;

      await mergeSettingsWithMcpPreservation(userPath, team, outPath);

      const got = await readJson(outPath);
      const want = await readJson(expectedPath);
      expect(got).toEqual(want as Record<string, unknown>);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
