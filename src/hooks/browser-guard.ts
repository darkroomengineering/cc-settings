#!/usr/bin/env bun
// Browser Guard: PreToolUse hook declared in agents/browser.md frontmatter, so it
// runs only inside the browser agent. The agent's `tools` list does not filter
// the tools of its inline chrome-devtools server; this hook is the gate.
//
//   exit 0               → ALLOW (silent)
//   exit 0 + JSON stdout → ASK, the user approves in a permission prompt
//   exit 2 + JSON stdout → BLOCK {"decision":"block","reason":"[Browser] ..."}
//
// Fail-closed, unlike the global hooks: a false block costs one agent call,
// while a false allow can upload a file, run a storage-reading script, or write
// outside the findings directory. Unparseable input and thrown errors block.
//
// Tool and field names match chrome-devtools-mcp@1.11.0 (build/src/tools/*.js).

import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPlainObject, processIO } from "../lib/hook-runtime.ts";

const CHROME_PREFIX = "mcp__chrome-devtools__";

export const ALLOWED_CHROME_TOOLS: ReadonlySet<string> = new Set([
  "navigate_page",
  "take_snapshot",
  "take_screenshot",
  "click",
  "fill",
  "type_text",
  "press_key",
  "evaluate_script",
  "list_pages",
  "new_page",
  "select_page",
  "close_page",
  "wait_for",
]);

// A source-text denylist cannot be complete, so these match whole families by
// substring and accept false blocks (a `.cookie-banner` selector) over misses.
// `[ 'a' + ` catches computed names built by concatenation (`window['local'+'Storage']`).
const STORAGE_RE = /[cC]ookie|Storage|indexedDB|\bcaches\b|\[\s*['"`][^'"`]*['"`]\s*\+/;
// Channels that can send non-GET requests or run code the regexes never see:
// XHR and window.open (`.open(`), beacons (always POST), sockets, form submits,
// dynamic code, scripted clicks and events (they drive the app's own writes),
// and `\u`/`\x` escapes (`document.\u0063ookie`). This is a tripwire for
// accidental use, not a sandbox: the prompt rule is the defense against an
// adversarial page.
const STATE_CHANGE_RE =
  /\.open\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\.submit\b|\[\s*['"`]submit|requestSubmit|\beval\b|\bFunction\b|\bimport\s*\(|\batob\b|fromCharCode|setTimeout\s*\(\s*['"`]|\.click\s*\(|dispatchEvent|\\[ux]/;
const METHOD_TOKEN_RE = /\bmethod\b/gi;
const METHOD_GET_RE = /['"`]?\bmethod\b['"`]?\s*:\s*['"`]GET['"`]/gi;

/** Every `method` in the source must be a literal `method: "GET"`; shorthand, variables and other verbs block. */
function hasNonGetMethod(source: string): boolean {
  const tokens = source.match(METHOD_TOKEN_RE)?.length ?? 0;
  const gets = source.match(METHOD_GET_RE)?.length ?? 0;
  return tokens !== gets;
}

export type Decision =
  | { kind: "allow" }
  | { kind: "ask"; reason: string }
  | { kind: "block"; reason: string };

const ALLOW: Decision = { kind: "allow" };
const ask = (reason: string): Decision => ({ kind: "ask", reason: `[Browser] ${reason}` });
const block = (reason: string): Decision => ({ kind: "block", reason: `[Browser] ${reason}` });

/** `base` is the real system temp dir. It must be temp: chrome-devtools-mcp
 *  saves files only under its client roots and `os.tmpdir()`, and Claude Code
 *  treats every Write under `~/.claude` as a sensitive file and asks first. */
export function findingsDir(base: string): string {
  return join(base, "claude-browser");
}

/** Resolve symlinks in the deepest existing ancestor, so a link planted inside
 *  the findings dir cannot point a write elsewhere. A dangling link has no real
 *  target to resolve and a write through it creates the target, so it returns
 *  undefined. */
function realTarget(path: string): string | undefined {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head)) {
    try {
      lstatSync(head);
      return undefined;
    } catch {}
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(basename(head));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

export function isInsideFindingsDir(path: string, base: string): boolean {
  if (!isAbsolute(path) || path.split(/[\\/]/).includes("..")) return false;
  const target = realTarget(path);
  if (target === undefined) return false;
  const rel = relative(findingsDir(base), target);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function webUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a = -1, b = -1] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** A host on this machine or the local network. The WHATWG parser has already
 *  normalized IPv4 spellings (`0x7f.1`, `2130706433`) to dotted decimal. A public
 *  name that resolves to a private address (DNS rebinding) is not caught. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::" || v6 === "::1") return true;
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (mapped) {
      const hi = Number.parseInt(mapped[1] ?? "", 16);
      const lo = Number.parseInt(mapped[2] ?? "", 16);
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  if (isPrivateIPv4(host)) return true;
  return !host.includes(".") || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host);
}

function checkUrl(tool: string, input: Record<string, unknown>): Decision | undefined {
  if (input.url === undefined) return undefined;
  const url = typeof input.url === "string" ? webUrl(input.url) : undefined;
  if (!url) {
    return block(`${tool} accepts only http and https URLs, got ${String(input.url)}.`);
  }
  // A page can tell the agent to visit a local admin URL; the user decides.
  if (isLocalHost(url.hostname)) {
    return ask(
      `${tool} wants to open ${url.href}, a local or internal address. Allow it only if you asked for this.`,
    );
  }
  return undefined;
}

function checkFilePath(tool: string, input: Record<string, unknown>, base: string) {
  if (input.filePath === undefined) return undefined;
  // The server resolves filePath against its own cwd and never expands `~`, so
  // isInsideFindingsDir accepts only absolute paths.
  if (typeof input.filePath !== "string" || !isInsideFindingsDir(input.filePath, base)) {
    return block(
      `${tool} may save output only under ${findingsDir(base)}/ as an absolute path, got ${String(input.filePath)}.`,
    );
  }
  return undefined;
}

function decideChrome(tool: string, input: Record<string, unknown>, base: string): Decision {
  if (!ALLOWED_CHROME_TOOLS.has(tool)) {
    return block(`${tool} is not allowed in the browser agent; it reads pages and nothing else.`);
  }
  const fileCheck = checkFilePath(tool, input, base);
  if (fileCheck) return fileCheck;

  if (tool === "navigate_page" || tool === "new_page") {
    if (input.initScript !== undefined) {
      return block(`${tool} initScript is not allowed; use evaluate_script after the page loads.`);
    }
    // The server accepts a "Leave site?" prompt by default, which discards what the page holds.
    if (tool === "navigate_page" && input.handleBeforeUnload !== "dismiss") {
      return block(
        `navigate_page needs handleBeforeUnload: "dismiss" so a "Leave site?" prompt is never accepted.`,
      );
    }
    const urlCheck = checkUrl(tool, input);
    if (urlCheck) return urlCheck;
  }

  if (tool === "evaluate_script") {
    const scriptOnly = "evaluate_script is for DOM reads and GET fetches only";
    if (input.sourcePath !== undefined) {
      return block(`${scriptOnly}; pass the source inline in \`function\`, not sourcePath.`);
    }
    // The server accepts page dialogs by default, which would confirm an app's own "Delete?".
    if (input.dialogAction !== "dismiss") {
      return block(
        `${scriptOnly}; set dialogAction: "dismiss" so a page dialog is never accepted.`,
      );
    }
    if (typeof input.function !== "string") {
      return block(`${scriptOnly}; \`function\` must be an inline source string.`);
    }
    if (STORAGE_RE.test(input.function)) {
      return block(`${scriptOnly}; reading cookies or browser storage is blocked.`);
    }
    if (STATE_CHANGE_RE.test(input.function) || hasNonGetMethod(input.function)) {
      return block(
        `${scriptOnly}; non-GET requests, XHR, window.open, sockets, form submits and dynamic code are blocked. Use fetch with no method or method: "GET".`,
      );
    }
  }
  return ALLOW;
}

/** The guard's whole decision, pure so tests can call it without stdin. */
export function decide(toolName: unknown, toolInput: unknown, base: string): Decision {
  if (typeof toolName !== "string" || toolName === "") {
    return block("hook payload has no tool_name; blocking by default.");
  }
  const input = isPlainObject(toolInput) ? toolInput : {};
  if (toolName.startsWith(CHROME_PREFIX)) {
    return decideChrome(toolName.slice(CHROME_PREFIX.length), input, base);
  }
  if (toolName === "Write" || toolName === "Read") {
    const filePath = input.file_path;
    if (typeof filePath !== "string" || !isInsideFindingsDir(filePath, base)) {
      return block(
        `${toolName} is only for findings files under ${findingsDir(base)}/ (got ${String(filePath)}). Use a path there and name it in the report.`,
      );
    }
  }
  return ALLOW;
}

/** Create the findings dir owner-only, or refuse one another user owns: on a
 *  shared Linux /tmp anyone can create `claude-browser` first and read what lands
 *  in it. Returns a block reason, or undefined when the dir is safe. */
export function secureFindingsDir(base: string): string | undefined {
  const dir = findingsDir(base);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory()) return `${dir} is not a directory; remove it and retry.`;
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    return `${dir} belongs to another user; remove it and retry.`;
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  return undefined;
}

export async function main(): Promise<void> {
  const payload = await processIO.hookInput<{ tool_name: string; tool_input: unknown }>();
  const base = realpathSync(tmpdir());
  const unsafe = secureFindingsDir(base);
  if (unsafe) processIO.block(`[Browser] ${unsafe}`);
  const decision = decide(payload.tool_name, payload.tool_input, base);
  if (decision.kind === "block") processIO.block(decision.reason);
  if (decision.kind === "ask") processIO.ask(decision.reason);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    processIO.block(`[Browser] guard error, blocking by default: ${String(error)}`);
  }
}
