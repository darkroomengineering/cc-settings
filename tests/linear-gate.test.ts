// Linear Gate: a PR in a Linear-mapped repo must name an issue of that team.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type GateDeps,
  gateReason,
  hasIssueId,
  type LinearTarget,
  lookup,
  main,
  prCommands,
} from "../src/hooks/linear-gate.ts";
import { captureIO, HookBlocked } from "../src/lib/hook-runtime.ts";
import type { LinearMap } from "../src/lib/knowledge-index.ts";

const CWD = "/work/app";

interface FakeOpts {
  origin?: string;
  branch?: string;
  teams?: Record<string, LinearTarget | null> | null;
  map?: LinearMap | null;
  files?: Record<string, string>;
}

function fakeDeps(opts: FakeOpts = {}): GateDeps & { originCalls: string[] } {
  const originCalls: string[] = [];
  return {
    originCalls,
    origin: async (cwd) => {
      originCalls.push(cwd);
      return opts.origin ?? "git@github.com:darkroomengineering/app.git";
    },
    branch: async () => opts.branch ?? "feat/new-thing",
    readTeams: async () => (opts.teams === undefined ? null : opts.teams),
    readMap: async () =>
      opts.map === undefined
        ? { "darkroomengineering/app": { team: "OSS", project: "app-site" } }
        : opts.map,
    readText: async (path) => {
      const text = opts.files?.[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
  };
}

describe("prCommands", () => {
  test.each([
    ["gh pr create --title X", { title: "X" }],
    ["gh pr create --title=X", { title: "X" }],
    ["gh pr create -t X", { title: "X" }],
    ["gh pr create -b 'Fixes OSS-1'", { body: "Fixes OSS-1" }],
    ["gh pr create --body=hi", { body: "hi" }],
    ["gh pr create -F notes.md", { bodyFile: "notes.md" }],
    ["gh pr create --body-file notes.md", { bodyFile: "notes.md" }],
    ["gh pr create -H oss-1-fix", { head: "oss-1-fix" }],
    ["gh pr create --head oss-1-fix", { head: "oss-1-fix" }],
    ["gh pr create -R o/r", { repo: "o/r" }],
    ["gh pr create --repo o/r", { repo: "o/r" }],
    ["gh pr create --fill", { fill: true }],
    ["gh pr create --fill-first", { fill: true }],
    ["CC_SKIP_LINEAR=1 gh pr create -t X", { skip: true, title: "X" }],
  ])("%s", (cmd, expected) => {
    const prs = prCommands(cmd);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ subcommand: "create", ...expected });
  });

  test("gh pr new is a create; gh pr edit is an edit", () => {
    expect(prCommands("gh pr new -t X")[0]?.subcommand).toBe("create");
    expect(prCommands("gh pr edit 3 --title X")[0]).toMatchObject({
      subcommand: "edit",
      title: "X",
    });
  });

  test("defaults: no fill, no skip", () => {
    expect(prCommands("gh pr create")[0]).toMatchObject({ fill: false, skip: false });
  });

  test.each([
    "gh pr list",
    "gh pr view 3",
    "gh issue create -t X",
    "git push",
    "echo gh pr create",
  ])("%s is not a gated command", (cmd) => expect(prCommands(cmd)).toEqual([]));

  test.each([
    "git push -u origin HEAD && gh pr create -t X",
    "printf body | gh pr create -t X -F -",
  ])("finds the create in %s", (cmd) => {
    expect(prCommands(cmd)).toMatchObject([{ subcommand: "create", title: "X" }]);
  });
});

describe("hasIssueId", () => {
  test.each(["Add hero (OSS-53)", "oss-53", "feat/oss-53-hero", "Fixes Oss-53."])(
    "%s names an OSS issue",
    (text) => expect(hasIssueId(text, "OSS")).toBe(true),
  );

  test.each([
    "Support UTF-8 filenames",
    "Bump to GPT-6",
    "Pin SHA-256 digest",
    "BOSS-5",
    "OSS53",
    "OSS-",
    "",
  ])("%s names no OSS issue", (text) => expect(hasIssueId(text, "OSS")).toBe(false));

  test("only the mapped team's key counts", () => {
    expect(hasIssueId("Fixes WEB-12", "OSS")).toBe(false);
    expect(hasIssueId("Fixes WEB-12", "WEB")).toBe(true);
  });
});

describe("lookup", () => {
  const map: LinearMap = {
    "darkroomengineering/app": { team: "MAP", project: "p" },
    "darkroomengineering/none": null,
  };

  test("the teams file wins over the cached map", () => {
    const teams = { "darkroomengineering/app": { team: "OWN" } };
    expect(lookup("darkroomengineering/app", teams, map)).toEqual({
      team: "OWN",
      project: undefined,
    });
  });

  test("a null in the teams file wins over a map entry", () => {
    expect(lookup("darkroomengineering/app", { "darkroomengineering/app": null }, map)).toBeNull();
  });

  test("falls through to the map when the teams file lacks the repo", () => {
    expect(lookup("darkroomengineering/app", { "other/repo": { team: "X" } }, map)).toEqual({
      team: "MAP",
      project: "p",
    });
  });

  test("slug match is case-insensitive", () => {
    expect(lookup("DarkroomEngineering/APP", null, map)?.team).toBe("MAP");
  });

  test("null entry means no Linear; missing means unlisted", () => {
    expect(lookup("darkroomengineering/none", null, map)).toBeNull();
    expect(lookup("darkroomengineering/missing", null, map)).toBeUndefined();
    expect(lookup("darkroomengineering/app", null, null)).toBeUndefined();
  });
});

describe("gateReason", () => {
  test("blocks a PR with no issue, naming team, project and the escape hatch", async () => {
    const reason = await gateReason("gh pr create -t 'Add hero' -b 'New hero'", CWD, fakeDeps());
    expect(reason).toContain("darkroomengineering/app");
    expect(reason).toContain("team OSS");
    expect(reason).toContain("project app-site");
    expect(reason).toContain("CC_SKIP_LINEAR=1");
    expect(reason).not.toContain("--fill");
  });

  test("--fill with no issue blocks and says to drop --fill", async () => {
    const reason = await gateReason("gh pr create --fill", CWD, fakeDeps());
    expect(reason).toContain("Drop --fill");
  });

  test.each([
    ["title", "gh pr create -t 'Add hero (OSS-53)' -b x", {}],
    ["inline body", "gh pr create -t 'Add hero' -b 'Fixes OSS-53'", {}],
    ["--head branch", "gh pr create -t 'Add hero' -H oss-53-hero", {}],
    ["current branch", "gh pr create -t 'Add hero'", { branch: "feat/oss-53-hero" }],
    [
      "relative body file",
      "gh pr create -t 'Add hero' -F body.md",
      { files: { [join(CWD, "body.md")]: "Fixes OSS-53" } },
    ],
    [
      "absolute body file",
      "gh pr create -t 'Add hero' --body-file /tmp/b.md",
      { files: { "/tmp/b.md": "Fixes OSS-53" } },
    ],
  ] as [string, string, FakeOpts][])(
    "passes with the issue in the %s",
    async (_where, cmd, opts) => {
      expect(await gateReason(cmd, CWD, fakeDeps(opts))).toBeNull();
    },
  );

  test("an unreadable body file counts as empty, so the PR still blocks", async () => {
    expect(await gateReason("gh pr create -t 'Add hero' -F gone.md", CWD, fakeDeps())).toContain(
      "team OSS",
    );
  });

  test("--head overrides the current branch", async () => {
    const deps = fakeDeps({ branch: "oss-53-hero" });
    expect(await gateReason("gh pr create -t 'Add hero' -H feat/x", CWD, deps)).toContain(
      "team OSS",
    );
  });

  test.each([
    ["an unmapped repo", { origin: "https://github.com/someone/else.git" }],
    ["a null-mapped repo", { map: { "darkroomengineering/app": null } }],
    ["no teams file and no fresh map", { teams: null, map: null }],
    ["a non-GitHub origin", { origin: "git@gitlab.com:darkroomengineering/app.git" }],
  ] as [string, FakeOpts][])("passes for %s", async (_name, opts) => {
    expect(await gateReason("gh pr create -t 'Add hero'", CWD, fakeDeps(opts))).toBeNull();
  });

  test("the teams file mapping applies when the map has nothing", async () => {
    const deps = fakeDeps({ map: null, teams: { "darkroomengineering/app": { team: "WEB" } } });
    expect(await gateReason("gh pr create -t 'Add hero (OSS-1)'", CWD, deps)).toContain("team WEB");
  });

  test("CC_SKIP_LINEAR=1 passes a PR with no issue", async () => {
    expect(
      await gateReason("CC_SKIP_LINEAR=1 gh pr create -t 'Add hero'", CWD, fakeDeps()),
    ).toBeNull();
  });

  test("gh pr edit without a title passes; with a title it is gated", async () => {
    expect(await gateReason("gh pr edit 1 --body-file x", CWD, fakeDeps())).toBeNull();
    expect(await gateReason("gh pr edit 1 --title 'Rename'", CWD, fakeDeps())).toContain(
      "team OSS",
    );
    expect(await gateReason("gh pr edit 1 --title 'Rename (OSS-9)'", CWD, fakeDeps())).toBeNull();
  });

  test("-R owner/repo is used instead of the origin", async () => {
    const deps = fakeDeps({
      origin: "https://github.com/someone/unmapped.git",
      map: { "darkroomengineering/other": { team: "OTH", project: "o" } },
    });
    const reason = await gateReason("gh pr create -R darkroomengineering/other -t x", CWD, deps);
    expect(reason).toContain("darkroomengineering/other maps to Linear team OTH");
    expect(deps.originCalls).toEqual([]);
  });

  test("a non-PR command never reads the mapping", async () => {
    const deps = fakeDeps();
    deps.readMap = async () => {
      throw new Error("must not read");
    };
    expect(await gateReason("gh pr list", CWD, deps)).toBeNull();
  });
});

describe("linear-gate handler", () => {
  async function run(tool: string, command: unknown): Promise<string | null> {
    const io = captureIO(JSON.stringify({ tool_name: tool, cwd: CWD, tool_input: { command } }));
    try {
      await main(io);
      return null;
    } catch (err) {
      if (err instanceof HookBlocked) return err.reason;
      throw err;
    }
  }

  // main() reads the real HOME and git through defaultDeps, so only paths that
  // return before gateReason touches a dependency are tested here.
  test("ignores other tools, missing commands and commands without gh", async () => {
    expect(await run("Edit", "gh pr create -t x")).toBeNull();
    expect(await run("Bash", undefined)).toBeNull();
    expect(await run("Bash", "git push")).toBeNull();
  });

  test("a skipped create returns before reading any mapping", async () => {
    expect(await run("Bash", "CC_SKIP_LINEAR=1 gh pr create -t x")).toBeNull();
  });
});
