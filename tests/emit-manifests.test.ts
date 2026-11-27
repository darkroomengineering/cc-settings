import { describe, expect, test } from "bun:test";
import { baseRecordProblems, type ManifestRecords } from "../src/scripts/emit-manifests.ts";

const base: ManifestRecords = {
  claude: [
    {
      version: 53,
      full: { added: ["rules/releases.md"], removed: [] },
      light: { added: [], removed: [] },
    },
  ],
  codex: [{ version: 40, added: ["src/lib/a.ts"], removed: [] }],
};

describe("baseRecordProblems", () => {
  test("accepts a candidate that keeps every base record and appends more", () => {
    const candidate: ManifestRecords = {
      claude: [
        ...base.claude,
        {
          version: 54,
          full: { added: ["docs/new.md"], removed: [] },
          light: { added: [], removed: [] },
        },
      ],
      codex: [...base.codex, { version: 41, added: [], removed: ["src/lib/a.ts"] }],
    };
    expect(baseRecordProblems(base, candidate)).toEqual([]);
    expect(baseRecordProblems(base, base)).toEqual([]);
    expect(baseRecordProblems({ claude: [], codex: [] }, candidate)).toEqual([]);
  });

  test("rejects a candidate that reuses a shipped version for a different list", () => {
    const candidate: ManifestRecords = {
      claude: [
        {
          version: 53,
          full: { added: ["docs/other.md"], removed: [] },
          light: { added: [], removed: [] },
        },
      ],
      codex: [{ version: 40, added: ["src/lib/b.ts"], removed: [] }],
    };
    expect(baseRecordProblems(base, candidate)).toEqual([
      "Claude record 0 differs from the base",
      "Codex runtime record 0 differs from the base",
    ]);
  });

  test("rejects a candidate that drops base records", () => {
    expect(baseRecordProblems(base, { claude: [], codex: base.codex })).toEqual([
      "Claude has 0 records; the base has 1",
    ]);
    expect(baseRecordProblems(base, { claude: base.claude, codex: [] })).toEqual([
      "Codex runtime has 0 records; the base has 1",
    ]);
  });
});
