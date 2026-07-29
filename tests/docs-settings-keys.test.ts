// Keeps docs/settings-reference.md's "Complete settings.json key reference"
// table in sync with the Settings zod schema.
//
// nuclear-review-2026-07-29 F4 reported this table as documenting 35 of 108
// keys. That number was wrong — it counted `###` prose headings, not table rows.
// The real measurement was 106 of 108, with zero phantom rows: `advisorModel`
// and `respondToBashCommands` had been typed in the schema without a row. A
// 2-key drift is small; the absence of anything to CATCH the drift is the
// finding, and this file is that missing mechanism.
//
// Deliberately a check, not a generator: the Class and Description columns carry
// judgment (which tier a key belongs to, what breaks if you set it) that cannot
// be derived from a zod type. Generation would flatten that to type names, so
// the table stays hand-written and this test enforces its completeness.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Settings } from "../src/schemas/settings.ts";

const DOC = join(import.meta.dir, "..", "docs", "settings-reference.md");
const SECTION_HEADING = "## Complete settings.json key reference";

function schemaRootKeys(): string[] {
  // `Settings` is a z.looseObject, so `.shape` enumerates exactly the typed
  // root keys. Unknown keys pass validation at runtime but aren't typed here,
  // and are therefore correctly out of scope for the table.
  return Object.keys((Settings as unknown as { shape: Record<string, unknown> }).shape);
}

function tableKeys(): string[] {
  const doc = readFileSync(DOC, "utf8");
  const start = doc.indexOf(SECTION_HEADING);
  if (start === -1) throw new Error(`"${SECTION_HEADING}" not found in ${DOC}`);
  // The section ends at the next h2. Scoping to it keeps keys mentioned in
  // prose elsewhere (or in the permissions autogen block) from counting.
  const rest = doc.slice(start + SECTION_HEADING.length);
  const end = rest.search(/^## /m);
  const section = end === -1 ? rest : rest.slice(0, end);
  // Row shape: | `key` | type | class | description |
  return [...section.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1] as string);
}

describe("docs/settings-reference.md key table", () => {
  test("documents every key the Settings schema types", () => {
    const undocumented = schemaRootKeys()
      .filter((k) => !new Set(tableKeys()).has(k))
      .sort();
    expect(undocumented).toEqual([]);
  });

  test("documents no key the Settings schema does not type", () => {
    const schema = new Set(schemaRootKeys());
    // A row with no schema key is either a typo or a key removed upstream —
    // both mislead a reader into setting something that won't validate.
    const phantom = tableKeys()
      .filter((k) => !schema.has(k))
      .sort();
    expect(phantom).toEqual([]);
  });

  test("has no duplicate rows", () => {
    const keys = tableKeys();
    // A duplicate is any key whose first occurrence is not this one. Two rows
    // for one key means two descriptions that can disagree.
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i).sort();
    expect(dupes).toEqual([]);
  });

  test("rows are sorted by codepoint, so a new key has exactly one slot", () => {
    const keys = tableKeys();
    expect(keys).toEqual([...keys].sort());
  });
});
