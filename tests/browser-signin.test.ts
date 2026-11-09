// browser-signin opens the agent's Chrome profile for a manual sign-in. Pure
// pieces only; Chrome is never launched.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromeArgs,
  chromePath,
  parseArgs,
  profileDir,
  profileLock,
  USAGE,
} from "../src/scripts/browser-signin.ts";

describe("profileDir", () => {
  test("is chrome-devtools-mcp's default profile under home", () => {
    expect(profileDir("/fake/home")).toBe(
      join("/fake/home", ".cache", "chrome-devtools-mcp", "chrome-profile"),
    );
  });
});

describe("parseArgs", () => {
  test("no args or two args print usage", () => {
    expect(parseArgs([])).toEqual({ ok: false, message: USAGE });
    expect(parseArgs(["https://a.com", "https://b.com"])).toEqual({ ok: false, message: USAGE });
  });

  test("non-URL rejected as not a URL", () => {
    const r = parseArgs(["example.com"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("not a URL: example.com");
      expect(r.message).toContain(USAGE);
    }
  });

  for (const [url, protocol] of [
    ["file:///etc/passwd", "file:"],
    ["javascript:alert(1)", "javascript:"],
    ["chrome://settings", "chrome:"],
  ] as const) {
    test(`${protocol} rejected by protocol`, () => {
      const r = parseArgs([url]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain(`only http and https URLs open here, got ${protocol}`);
    });
  }

  test("http and https accepted unchanged", () => {
    expect(parseArgs(["http://localhost:3000/login"])).toEqual({
      ok: true,
      url: "http://localhost:3000/login",
    });
    expect(parseArgs(["https://search.google.com/search-console"])).toEqual({
      ok: true,
      url: "https://search.google.com/search-console",
    });
  });
});

describe("profileLock", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-browser-signin-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const lock = (target: string) => symlinkSync(target, join(dir, "SingletonLock"));

  test("no SingletonLock is free", () => {
    expect(profileLock(dir, "darwin")).toEqual({ state: "free" });
    expect(profileLock(dir, "linux")).toEqual({ state: "free" });
  });

  test("lock held by a live pid is in use", () => {
    lock(`${hostname()}-${process.pid}`);
    const r = profileLock(dir, "darwin");
    expect(r.state).toBe("in-use");
    if (r.state === "in-use") expect(r.detail).toContain(String(process.pid));
  });

  test("a SingletonLock that is not a symlink is in use, not free", () => {
    writeFileSync(join(dir, "SingletonLock"), "x");
    expect(profileLock(dir, "darwin").state).toBe("in-use");
  });

  test("lock held by a dead pid is stale", () => {
    lock("some-host-424242");
    expect(profileLock(dir, "linux", () => false)).toEqual({ state: "stale", pid: 424242 });
  });

  test("isAlive receives the pid from the lock target", () => {
    lock("my-host.local-1234");
    const seen: number[] = [];
    profileLock(dir, "darwin", (pid) => {
      seen.push(pid);
      return true;
    });
    expect(seen).toEqual([1234]);
  });

  // An unparseable lock must not be treated as free: two Chromes on one profile corrupt it.
  for (const target of ["garbage", "host-abc", "host-", "host-0", "host-1.5"]) {
    test(`unreadable target ${JSON.stringify(target)} is in use`, () => {
      lock(target);
      const r = profileLock(dir, "darwin", () => false);
      expect(r.state).toBe("in-use");
      if (r.state === "in-use") expect(r.detail).toContain("unreadable SingletonLock target");
    });
  }

  test("Windows: lockfile present is in use, absent is free", () => {
    expect(profileLock(dir, "win32")).toEqual({ state: "free" });
    writeFileSync(join(dir, "lockfile"), "");
    const r = profileLock(dir, "win32");
    expect(r.state).toBe("in-use");
    if (r.state === "in-use") expect(r.detail).toContain(join(dir, "lockfile"));
  });

  test("Windows ignores a POSIX SingletonLock", () => {
    lock(`${hostname()}-${process.pid}`);
    expect(profileLock(dir, "win32")).toEqual({ state: "free" });
  });
});

describe("chromePath", () => {
  const never = () => false;
  const noWhich = () => null;

  test("CHROME_PATH wins on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(chromePath(platform, { CHROME_PATH: "/opt/chrome" }, never, noWhich)).toBe(
        "/opt/chrome",
      );
    }
  });

  test("darwin uses the app bundle when it exists", () => {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(chromePath("darwin", {}, (p) => p === mac, noWhich)).toBe(mac);
    expect(chromePath("darwin", {}, never, noWhich)).toBeUndefined();
  });

  test("win32 checks ProgramFiles, ProgramFiles(x86), then LOCALAPPDATA", () => {
    const env = {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
    };
    const exe = "Google\\Chrome\\Application\\chrome.exe";
    const checked: string[] = [];
    const onlyLocal = (p: string) => {
      checked.push(p);
      return p.startsWith(env.LOCALAPPDATA);
    };
    expect(chromePath("win32", env, onlyLocal, noWhich)).toBe(`${env.LOCALAPPDATA}\\${exe}`);
    expect(checked).toEqual([
      `${env.ProgramFiles}\\${exe}`,
      `${env["ProgramFiles(x86)"]}\\${exe}`,
      `${env.LOCALAPPDATA}\\${exe}`,
    ]);
    expect(chromePath("win32", env, () => true, noWhich)).toBe(`${env.ProgramFiles}\\${exe}`);
    expect(chromePath("win32", env, never, noWhich)).toBeUndefined();
    expect(chromePath("win32", {}, () => true, noWhich)).toBeUndefined();
  });

  test("linux takes the first binary found on PATH", () => {
    const found = (bin: string) => (bin === "google-chrome-stable" ? "/usr/bin/gcs" : null);
    expect(chromePath("linux", {}, never, found)).toBe("/usr/bin/gcs");
    expect(chromePath("linux", {}, never, (b) => `/usr/bin/${b}`)).toBe("/usr/bin/google-chrome");
    expect(
      chromePath("linux", {}, never, (b) => (b === "chromium" ? "/snap/chromium" : null)),
    ).toBe("/snap/chromium");
    expect(chromePath("linux", {}, never, noWhich)).toBeUndefined();
  });
});

describe("chromeArgs", () => {
  // The keychain and password-store flags must match Puppeteer's defaults, or
  // cookies saved here are unreadable by the agent's Chrome.
  test("points at the profile, matches Puppeteer's storage flags, url last", () => {
    const args = chromeArgs("/p/profile", "https://example.com/login");
    expect(args).toContain("--user-data-dir=/p/profile");
    expect(args).toContain("--use-mock-keychain");
    expect(args).toContain("--password-store=basic");
    expect(args).toContain("--disable-sync");
    expect(args).toContain("--no-first-run");
    expect(args.at(-1)).toBe("https://example.com/login");
    expect(args.filter((a) => a.startsWith("--user-data-dir="))).toHaveLength(1);
  });
});
