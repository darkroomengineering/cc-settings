import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { parseArgs } from "node:util";

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { markdownPath, words } from "@visio/aeo/internal/smoke";
import {
  inspectBoundaries,
  isPending,
  matchPath,
} from "@visio/router/internal/smoke";
import { extractLinks, httpTransport, runPrerender } from "prerender-crawler";
import type { SkippedPage } from "prerender-crawler";

import { launchChrome } from "./chrome.ts";
import type { Chrome, Message } from "./chrome.ts";
import { headTrip } from "./head-trip.ts";

/** How long one server render may take. Vite's own module timeout is 60 s. */
const RENDER_TIMEOUT = 90_000;

/** How long a page may take to fire its load event in Chrome. */
const LOAD_TIMEOUT = 60_000;

/** The network counts as quiet after this long with no request in flight. */
const QUIET = 500;

/** And a page that never goes quiet (a poll, a stream) is read after this. */
const QUIET_MAX = 15_000;

/** The not-found page: the catch-all answers it with a 404 by design. */
const NOT_FOUND = "/404";

// ---------------------------------------------------------------------------
// Options

export interface SmokeOptions {
  /** Paths in findings are relative to it. */
  root: string;
  /** The app: its `vite.config.ts`, `src/routes.ts` and `node_modules/.bin/vite`. */
  dir: string;
  /** A running dev server; without it, one is started. */
  url?: string;
  port?: number;
  only?: string[];
  /** The SEO and JavaScript-only-text checks. */
  site: boolean;
}

/** The app folder, then `--url`, `--port` and `--only /a,/b`. */
export function smokeArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      port: { type: "string" },
      only: { type: "string" },
    },
  });

  return {
    app: positionals[0],
    url: values.url,
    port: values.port === undefined ? undefined : Number(values.port),
    only: values.only?.split(","),
  };
}

let root = "";
let appDir = "";
let app = "";
let only: string[] | undefined;
let requestedPort: number | undefined;
let site = true;

// ---------------------------------------------------------------------------
// Findings

type Kind =
  | "status"
  | "link"
  | "boundary"
  | "seo"
  | "agent"
  | "console"
  | "diagnostic"
  | "exception"
  | "request"
  | "log"
  | "server"
  | "head"
  | "expected";

interface Finding {
  level: "error" | "warning";
  kind: Kind;
  message: string;
  /** `path:line:col` in the repo, when a stack or the server names one. */
  at?: string;
}

/** Findings per page; `(server)` holds what the dev server printed between pages. */
const findings = new Map<string, Finding[]>();

function report(page: string, finding: Finding) {
  const list = findings.get(page) ?? [];
  list.push(finding);
  findings.set(page, list);
}

/** Per page, a part of each message it causes on purpose (`data-smoke-expect`). */
const expected = new Map<string, string[]>();

const ENTITIES = new Map([
  ["amp", "&"],
  ["quot", '"'],
  ["#39", "'"],
  ["lt", "<"],
  ["gt", ">"],
]);

/** A named group the pattern always fills when it matches. */
function group(match: RegExpExecArray, key: string): string {
  const value = match.groups?.[key];

  if (value === undefined) {
    throw new Error(`the "${key}" group did not take part in the match`);
  }

  return value;
}

function expectedFindings(html: string): string[] {
  return [...html.matchAll(/data-smoke-expect="(?<value>[^"]*)"/gu)].map(
    (match) =>
      group(match, "value").replaceAll(
        /&(?<name>amp|quot|#39|lt|gt);/gu,
        (entity, name: string) => ENTITIES.get(name) ?? entity
      )
  );
}

/** A Solid dev diagnostic starts with its code in brackets: `[LAZY_ASSET_UNMAPPED] ...`. */
const CODE = /\[(?<code>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/u;

const FOOTER =
  /^\s*\[[A-Z0-9_]+\]\s*(?:what it means and how to fix it|agent repair guide|deeper evidence):/u;

/** The first two lines of a message, each cut to a length a terminal line holds. */
function brief(text: string): string {
  return text
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 2)
    .map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l))
    .join("\n      ");
}

// Only the server HTML counts: a crawler that runs no script sees nothing else.
function seoFindings(html: string): Finding[] {
  const found: Finding[] = [];

  function seo(level: Finding["level"], message: string) {
    found.push({ level, kind: "seo", message });
  }

  const head =
    /<head[^>]*>(?<head>[\s\S]*?)<\/head>/iu.exec(html)?.groups?.head ?? "";

  const titles = [
    ...head.matchAll(/<title[^>]*>(?<title>[\s\S]*?)<\/title>/giu),
  ];

  const [title] = titles;

  if (titles.length !== 1 || !title) {
    seo("error", `${titles.length} <title> tags in the head, want 1`);
  } else if (!group(title, "title").trim()) {
    seo("error", "the <title> is empty");
  }

  const noindex = /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/iu.test(
    head
  );

  if (
    !noindex &&
    !/<meta[^>]+name="description"[^>]+content="[^"]+"/iu.test(head)
  ) {
    seo("warning", "no meta description");
  }

  const h1s = html.match(/<h1[\s>]/giu)?.length ?? 0;

  if (h1s !== 1) {
    seo("warning", `${h1s} <h1> elements, want 1`);
  }

  for (const match of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>(?<json>[\s\S]*?)<\/script>/giu
  )) {
    const json = group(match, "json");

    try {
      JSON.parse(json);
    } catch {
      seo("error", `JSON-LD does not parse: ${brief(json)}`);
    }
  }

  return found;
}

// No AI crawler but Google's and Apple's runs scripts: text that only the browser renders is not there for them.
function clientOnlyFinding(
  server: string,
  hydrated: string
): Finding | undefined {
  const before = words(server);
  const added = [...words(hydrated)].filter((w) => !before.has(w));

  if (!added.length) {
    return undefined;
  }

  const shown = added.slice(0, 12).join(" ");

  return {
    level: "warning",
    kind: "agent",
    message: `${added.length} word(s) appear only after JavaScript runs, so AI crawlers never read them: ${shown}${added.length > 12 ? " …" : ""}. Render them on the server, or mark them aria-hidden or data-agent="skip" if they are not content.`,
  };
}

// ---------------------------------------------------------------------------
// The dev server: started on a free port, or the one --url names

// oxlint-disable-next-line no-control-regex -- ANSI colour codes in the server's output
const ANSI = /\u001B\[[0-9;]*m/gu;

/** The page being rendered or loaded; what the server prints meanwhile is about it. */
let current: string | undefined;

function freePort(): Promise<number> {
  const free = Promise.withResolvers<number>();
  const server = createServer();
  server.once("error", free.reject);
  server.listen(0, () => {
    // SAFETY: a server that listens on a TCP port has an address with a port.
    const { port } = server.address() as { port: number };
    server.close(() => free.resolve(port));
  });

  return free.promise;
}

/**
 * Reads the dev server's output for warnings and errors. An entry is a line
 * that says error, warn or failed, or carries a diagnostic code; the indented
 * lines after it (Vite's `File:`, a stack) give its location.
 */
interface ServerEntry {
  page: string;
  finding: Finding;
  file?: string;
  frames: string[];
}

/** An indented line under an entry: Vite's `File:` line, or a stack frame. */
function addLocation(entry: ServerEntry, line: string): void {
  const file = /^\s*File:\s*(?<file>\S+)/u.exec(line)?.groups?.file;

  const frame =
    /^\s*at .*?\(?(?<frame>(?:\/|file:\/\/)[^()\s]+:\d+:\d+)\)?$/u.exec(line)
      ?.groups?.frame;

  if (file) {
    entry.file ??= file;
  } else if (frame && !frame.includes("/node_modules/")) {
    entry.frames.push(frame.replace(/^file:\/\//u, ""));
  }
}

function watchServer(child: ChildProcess) {
  let entry: ServerEntry | undefined;

  // Vite's `File:` line, else the first frame in the app, else in a package.
  function flush() {
    if (!entry) {
      return;
    }

    const where =
      entry.file ??
      entry.frames.find((f) => f.startsWith(`${appDir}/`)) ??
      entry.frames[0];

    report(
      entry.page,
      where
        ? { ...entry.finding, at: nodePath.relative(root, where) }
        : entry.finding
    );
    entry = undefined;
  }

  function onLine(raw: string) {
    const line = raw.replaceAll(ANSI, "").trimEnd();

    if (!line.trim()) {
      return;
    }

    if (entry && /^\s/u.test(line)) {
      addLocation(entry, line);

      return;
    }

    flush();
    const text = line.replace(/^\d{1,2}:\d{2}:\d{2}\s*(?:[AP]M)?\s*/u, "");

    // Vite echoes the browser's console; Chrome already reported it.
    if (/\(client\) \[(?:console\.|Unhandled)/u.test(text)) {
      return;
    }

    if (FOOTER.test(text)) {
      return;
    }

    const code = CODE.exec(text)?.groups?.code;
    const error = /\berror\b|\bfailed\b|\bexception\b/iu.test(text);

    if (!code && !error && !/\bwarn(?:ing)?\b/iu.test(text)) {
      return;
    }

    entry = {
      page: current ?? "(server)",
      finding: {
        level: error ? "error" : "warning",
        kind: code ? "diagnostic" : "server",
        message: brief(text),
      },
      frames: [],
    };
  }

  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) {
      throw new Error("the dev server's output is not piped");
    }

    let rest = "";
    stream.on("data", (chunk: Buffer) => {
      const buffered = rest + chunk.toString();
      const end = buffered.lastIndexOf("\n");
      rest = buffered.slice(end + 1);

      if (end !== -1) {
        for (const l of buffered.slice(0, end).split("\n")) {
          onLine(l);
        }
      }
    });
  }

  return flush;
}

let dev: ChildProcess | undefined;
let flushServer: (() => void) | undefined;

/** Starts the dev server on the `port` or a free one, and gives its origin. */
async function startServer(): Promise<string> {
  const listen = requestedPort ?? (await freePort());
  // Its own process group, so stopping it stops what it started (the Studio).
  dev = spawn(
    "bun",
    [
      "--bun",
      nodePath.join(appDir, "node_modules", ".bin", "vite"),
      "--port",
      String(listen),
      "--strictPort",
    ],
    {
      cwd: appDir,
      env: { ...process.env, PUBLIC_SITE_INDEXABLE: "true" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  );
  flushServer = watchServer(dev);

  return `http://localhost:${listen}`;
}

let origin = "";

function stopServer() {
  if (dev?.pid && dev.exitCode === null) {
    try {
      process.kill(-dev.pid, "SIGTERM");
    } catch {
      // It exited on its own meanwhile.
    }
  }
}

/**
 * Waits until the server answers `/` with a page. The first render compiles
 * the app, which on a busy machine takes a minute or more.
 */
async function ready(deadline = Date.now() + 180_000) {
  for (;;) {
    if (dev && dev.exitCode !== null) {
      throw new Error(
        `The dev server exited (${dev.exitCode}) before it answered.`
      );
    }

    try {
      // oxlint-disable-next-line no-await-in-loop -- polling
      const res = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(RENDER_TIMEOUT),
      });

      // oxlint-disable-next-line no-await-in-loop
      await res.arrayBuffer();

      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`${origin} did not answer`, { cause: error });
      }

      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(500);
    }
  }
}

// The page's Markdown copy, as an agent asks for it (@visio/aeo).
async function markdownFinding(path: string): Promise<Finding | undefined> {
  const at = markdownPath(path);

  try {
    const response = await fetch(origin + at);
    const type = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const isMarkdown = response.ok && type.startsWith("text/markdown");

    if (isMarkdown && text.replace(/^---\n[\s\S]*?\n---\n/u, "").trim()) {
      return undefined;
    }

    return {
      level: "error",
      kind: "agent",
      message: `${at} answered ${response.status} ${type || "without a type"}${isMarkdown ? " with no text" : ""}, want the page as Markdown (@visio/aeo).`,
    };
  } catch (error) {
    return {
      level: "error",
      kind: "agent",
      message: `${at}: ${String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// The routes: the prerender crawl, over HTTP, against the dev server

/** The app's `api()` patterns and its `pending` paths, which the crawl leaves alone. */
async function skippedPatterns(): Promise<{
  api: string[];
  pending: readonly string[];
}> {
  try {
    const {
      routes,
    }: {
      routes: { api: readonly { path: string }[]; pending: readonly string[] };
    } = await import(nodePath.join(appDir, "src", "routes.ts"));

    return { api: routes.api.map((r) => r.path), pending: routes.pending };
  } catch (error) {
    console.error(
      `Could not read ${app}/src/routes.ts for its api() and pending routes: ${String(error)}`
    );

    return { api: [], pending: [] };
  }
}

interface Page {
  path: string;
  status: number;
  html: string;
}

/** What the extensions serve themselves (the Studio, Sanity's routes): the dev server writes it on start. */
function servedPaths(): string[] {
  try {
    const paths: string[] = JSON.parse(
      readFileSync(nodePath.join(appDir, ".visio", "paths.json"), "utf-8")
    );

    return paths;
  } catch {
    return [];
  }
}

async function crawl(): Promise<Page[]> {
  const { api, pending } = await skippedPatterns();
  const served = servedPaths();

  function skip(path: string) {
    return (
      served.some((base) => path === base || path.startsWith(`${base}/`)) ||
      api.some((pattern) => matchPath(pattern, path) !== null) ||
      isPending(path, pending)
    );
  }

  const statuses = new Map<string, number>();
  let notFound = "";

  const transport = httpTransport(origin, {
    // SAFETY: Bun's fetch type adds preconnect, which the transport never reads; it only calls it.
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      current = url.pathname;

      // The whole body inside the timeout: a stream that never ends is a
      // finding on the page, not a crawl that hangs.
      try {
        const res = await fetch(input, {
          ...init,
          signal: AbortSignal.timeout(RENDER_TIMEOUT),
        });

        const body = await res.arrayBuffer();
        statuses.set(url.pathname, res.status);

        if (url.pathname === NOT_FOUND) {
          notFound = new TextDecoder().decode(body);
        }

        return new Response(body, res);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TimeoutError") {
          throw error;
        }

        throw new Error(
          `the server render did not finish within ${RENDER_TIMEOUT / 1000} s`,
          {
            cause: error,
          }
        );
      }
    }) as typeof fetch,
  });

  const outDir = mkdtempSync(nodePath.join(tmpdir(), "visio-smoke-"));

  try {
    const result = await runPrerender({
      transport,
      outDir,
      origin,
      mode: "hybrid",
      pages: only ?? ["/", NOT_FOUND],
      filter: (path) => !skip(path) && (!only || only.includes(path)),
      emitPages: false,
      redirectStubs: false,
      failOnError: false,
      // One page at a time: the dev server compiles on demand, and what it
      // prints belongs to the page in flight.
      concurrency: 1,
      // A page that fails is the finding; a retry would only hide a flaky one.
      retries: 0,
    });

    current = undefined;

    // Who links to what, from the HTML itself (announced paths are not links).
    const linkedFrom = new Map<string, string[]>();
    const pages: Page[] = [];

    for (const page of result.pages) {
      if (page.redirect) {
        continue;
      }

      if (
        !(page.response.headers.get("content-type") ?? "").includes("text/html")
      ) {
        continue;
      }

      pages.push({
        path: page.path,
        status: page.response.status,
        html: page.html,
      });

      for (const to of extractLinks(page.html, new URL(page.path, origin))) {
        const from = linkedFrom.get(to) ?? [];
        from.push(page.path);
        linkedFrom.set(to, from);
      }
    }

    for (const { path, error } of result.skipped) {
      const status = statuses.get(path);

      if (status === 404 && path === NOT_FOUND) {
        pages.push({ path, status, html: notFound });
        continue;
      }

      const from = linkedFrom.get(path);

      if (status === 404 && from?.length) {
        for (const page of from) {
          report(page, {
            level: "error",
            kind: "link",
            message: `links to ${path}, which is a 404`,
          });
        }

        continue;
      }

      report(path, {
        level: "error",
        kind: "status",
        message: status
          ? `answered ${status}${from ? ` (linked from ${from.join(", ")})` : ""}`
          : brief(errorMessage(error)),
      });
    }

    return pages.toSorted((a, b) => a.path.localeCompare(b.path));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** The cause's message when there is one: a timeout wraps the fetch error. */
function errorMessage(error: SkippedPage["error"]): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  return error.cause instanceof Error ? error.cause.message : error.message;
}

// ---------------------------------------------------------------------------
// Source locations: a stack frame on the dev server, mapped to the repo

const maps = new Map<string, Promise<TraceMap | undefined>>();

async function sourceMap(url: string): Promise<TraceMap | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const code = await response.text();

    const inline =
      /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(?<map>\S+)\s*$/u.exec(
        code
      )?.groups?.map;

    return inline
      ? new TraceMap(Buffer.from(inline, "base64").toString(), url)
      : undefined;
  } catch {
    return undefined;
  }
}

interface Frame {
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * A file the dev server serves, as a path in the repo: `/src/x.tsx` is the
 * app's, `/@fs/abs/path` any other file (a workspace package).
 */
function repoPath(file: string): string {
  const path = decodeURIComponent(file.replace(/\?.*$/u, ""));

  return nodePath.relative(root, absolutePath(path));
}

function absolutePath(path: string): string {
  if (path.startsWith("/@fs/")) {
    return path.slice(4);
  }

  return path.startsWith(root) ? path : nodePath.join(appDir, path);
}

/**
 * Where a stack points: the first frame in the app, else the first in a
 * workspace package, mapped through the dev server's source map to a line
 * in the repo. A stack only through dependencies or Vite's client names no
 * place to fix, and gives none.
 */
async function locate(
  frames: readonly Frame[] | undefined
): Promise<string | undefined> {
  function served(f: Frame) {
    return f.url.startsWith(origin) && !f.url.includes("/node_modules/");
  }

  function inApp(f: Frame) {
    return served(f) && f.url.startsWith(`${origin}/src/`);
  }

  function inPackage(f: Frame) {
    return served(f) && f.url.startsWith(`${origin}/@fs/`);
  }

  const frame = frames?.find(inApp) ?? frames?.find(inPackage);

  if (!frame) {
    return undefined;
  }

  const { url } = frame;
  let mapped = maps.get(url);

  if (!mapped) {
    mapped = sourceMap(url);
    maps.set(url, mapped);
  }

  const map = await mapped;

  const pos = map
    ? originalPositionFor(map, {
        line: frame.lineNumber + 1,
        column: frame.columnNumber,
      })
    : undefined;

  if (pos?.source) {
    const file = pos.source.startsWith("/")
      ? pos.source
      : new URL(pos.source, url).pathname;

    return `${repoPath(file)}:${pos.line}:${(pos.column ?? 0) + 1}`;
  }

  return `${repoPath(url.slice(origin.length))}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
}

// ---------------------------------------------------------------------------
// Chrome: one load per page, everything the console and the network say

interface RemoteObject {
  type: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

function display(o: RemoteObject): string {
  return o.type === "string"
    ? String(o.value)
    : (o.unserializableValue ??
        o.description ??
        JSON.stringify(o.value) ??
        o.type);
}

/** A console call's arguments as the console shows them, `%s`/`%o`/`%c` applied. */
function formatArgs(list: readonly RemoteObject[]): string {
  const [first, ...rest] = list;

  if (!first) {
    return "";
  }

  let head = display(first);

  if (first.type === "string") {
    head = head.replaceAll(/%[sdifoOc]/gu, (spec) => {
      const arg = rest.shift();

      return !arg || spec === "%c" ? "" : display(arg);
    });
  }

  return [head, ...rest.map(display)].join(" ");
}

/** `head` findings for one page, from `headTrip()`. */
async function roundTrip(
  chrome: Awaited<ReturnType<typeof launchChrome>>,
  path: string,
  others: readonly string[]
): Promise<boolean> {
  const { checked, problem } = await headTrip(chrome, origin, path, others);

  if (problem) {
    report(path, { level: "error", kind: "head", message: problem });
  }

  return checked;
}

/** The params of the protocol events `load()` reads. */
interface Events {
  "Runtime.consoleAPICalled": {
    type: string;
    args: RemoteObject[];
    stackTrace?: { callFrames: Frame[] };
  };
  "Runtime.exceptionThrown": {
    exceptionDetails: {
      text: string;
      exception?: { description?: string; value?: unknown };
      url?: string;
      lineNumber: number;
      columnNumber: number;
      stackTrace?: { callFrames: Frame[] };
    };
  };
  "Log.entryAdded": {
    entry: {
      source: string;
      level: string;
      text: string;
      stackTrace?: { callFrames: Frame[] };
    };
  };
  "Network.requestWillBeSent": { requestId: string; request: { url: string } };
  "Network.responseReceived": { response: { url: string; status: number } };
  "Network.loadingFinished": { requestId: string };
  "Network.loadingFailed": {
    requestId: string;
    errorText: string;
    canceled?: boolean;
  };
}

function paramsOf<K extends keyof Events>(m: Message, _method: K): Events[K] {
  // SAFETY: the caller matched `m.method` to `_method`, and Chrome sends these params with that event.
  return m.params as Events[K];
}

/** Whether the promise fulfils; a rejection is an answer here, not an error. */
async function settles(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;

    return true;
  } catch {
    return false;
  }
}

/** Loads the page and gives its document once the network is quiet. */
async function load(
  chrome: Awaited<ReturnType<typeof launchChrome>>,
  path: string
): Promise<string | undefined> {
  const { send, once, listeners, open } = chrome;
  const { targetId, sessionId } = await open();
  const pendingFindings: Promise<void>[] = [];

  async function locateAndReport(finding: Finding, frames?: readonly Frame[]) {
    const at = await locate(frames);
    report(path, at && !finding.at ? { ...finding, at } : finding);
  }

  function add(finding: Finding, frames?: readonly Frame[]) {
    pendingFindings.push(locateAndReport(finding, frames));
  }

  const inflight = new Set<string>();
  const urls = new Map<string, string>();
  let lastActivity = Date.now();

  function consoleCalled({
    type,
    args: list,
    stackTrace,
  }: Events["Runtime.consoleAPICalled"]) {
    if (type !== "error" && type !== "warning" && type !== "assert") {
      return;
    }

    const message = formatArgs(list);
    const code = CODE.exec(message)?.groups?.code;

    // Solid prints a diagnostic's first report with two footers of its
    // own, the repair guide and the attribution hint; the code says both.
    if (code && FOOTER.test(message)) {
      return;
    }

    add(
      {
        level: type === "warning" ? "warning" : "error",
        kind: code ? "diagnostic" : "console",
        message: brief(message),
      },
      // A diagnostic's stack is the scheduler's, not the scope's; its
      // `in` line (the second line of the message) names the owner.
      code ? undefined : stackTrace?.callFrames
    );
  }

  function exceptionThrown({
    exceptionDetails: d,
  }: Events["Runtime.exceptionThrown"]) {
    const detail = d.exception?.description ?? String(d.exception?.value ?? "");
    const firstLine = detail.split("\n")[0] ?? "";

    const frames =
      d.stackTrace?.callFrames ??
      (d.url
        ? [
            {
              url: d.url,
              lineNumber: d.lineNumber,
              columnNumber: d.columnNumber,
            },
          ]
        : undefined);

    add(
      {
        level: "error",
        kind: "exception",
        message: brief(`${d.text} ${firstLine}`),
      },
      frames
    );
  }

  function entryAdded({ entry }: Events["Log.entryAdded"]) {
    // Network entries repeat what the Network events report.
    if (entry.source === "network") {
      return;
    }

    if (entry.level !== "error" && entry.level !== "warning") {
      return;
    }

    // A performance hint from SwiftShader, the software WebGL headless
    // runs on, about its own readback; no GPU prints it.
    if (
      entry.source === "rendering" &&
      /GL Driver Message .*GPU stall/u.test(entry.text)
    ) {
      return;
    }

    add(
      {
        level: entry.level,
        kind: "log",
        message: brief(`${entry.source}: ${entry.text}`),
      },
      entry.stackTrace?.callFrames
    );
  }

  function requestSent({
    requestId,
    request,
  }: Events["Network.requestWillBeSent"]) {
    if (request.url.startsWith("data:")) {
      return;
    }

    inflight.add(requestId);
    urls.set(requestId, request.url);
    lastActivity = Date.now();
  }

  function responseReceived({ response }: Events["Network.responseReceived"]) {
    if (
      response.status >= 400 &&
      !(path === NOT_FOUND && response.url === `${origin}${path}`)
    ) {
      report(path, {
        level: "error",
        kind: "request",
        message: `${response.status} ${response.url.replace(origin, "")}`,
      });
    }
  }

  function loadingFailed({
    requestId,
    errorText,
    canceled,
  }: Events["Network.loadingFailed"]) {
    inflight.delete(requestId);
    lastActivity = Date.now();

    if (!canceled) {
      report(path, {
        level: "error",
        kind: "request",
        message: `${errorText} ${(urls.get(requestId) ?? "").replace(origin, "")}`,
      });
    }
  }

  function on(m: Message) {
    if (m.sessionId !== sessionId) {
      return;
    }

    switch (m.method) {
      case "Runtime.consoleAPICalled": {
        consoleCalled(paramsOf(m, "Runtime.consoleAPICalled"));
        break;
      }

      case "Runtime.exceptionThrown": {
        exceptionThrown(paramsOf(m, "Runtime.exceptionThrown"));
        break;
      }

      case "Log.entryAdded": {
        entryAdded(paramsOf(m, "Log.entryAdded"));
        break;
      }

      case "Network.requestWillBeSent": {
        requestSent(paramsOf(m, "Network.requestWillBeSent"));
        break;
      }

      case "Network.responseReceived": {
        responseReceived(paramsOf(m, "Network.responseReceived"));
        break;
      }

      case "Network.loadingFinished": {
        inflight.delete(paramsOf(m, "Network.loadingFinished").requestId);
        lastActivity = Date.now();
        break;
      }

      case "Network.loadingFailed": {
        loadingFailed(paramsOf(m, "Network.loadingFailed"));
        break;
      }

      default: {
        break;
      }
    }
  }

  listeners.add(on);

  try {
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);

    const loaded = settles(
      once("Page.loadEventFired", sessionId, LOAD_TIMEOUT)
    );

    const { errorText } = await send<{ errorText?: string }>(
      "Page.navigate",
      { url: origin + path },
      sessionId
    );

    if (errorText) {
      report(path, {
        level: "error",
        kind: "request",
        message: `navigation failed: ${errorText}`,
      });

      return;
    }

    if (!(await loaded)) {
      report(path, {
        level: "error",
        kind: "status",
        message: `no load event within ${LOAD_TIMEOUT / 1000} s`,
      });

      return;
    }

    // Lazy chunks and data after load: wait for the network to go quiet.
    const until = Date.now() + QUIET_MAX;

    while (
      Date.now() < until &&
      (inflight.size > 0 || Date.now() - lastActivity < QUIET)
    ) {
      // oxlint-disable-next-line no-await-in-loop -- polling
      await Bun.sleep(100);
    }

    await send(
      "Runtime.evaluate",
      {
        expression:
          "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
        awaitPromise: true,
      },
      sessionId
    );

    const { result } = await send<{ result: { value?: string } }>(
      "Runtime.evaluate",
      { expression: "document.documentElement.outerHTML", returnByValue: true },
      sessionId
    );

    return result.value;
  } finally {
    listeners.delete(on);
    await send("Target.closeTarget", { targetId }).catch(() => {
      // The tab may be gone with Chrome already.
    });
    await Promise.all(pendingFindings);
  }
}

// ---------------------------------------------------------------------------
// The report

/** Pages by path, with what the server printed between pages at the end. */
function serverLast(a: string, b: string): number {
  if (a === "(server)") {
    return 1;
  }

  if (b === "(server)") {
    return -1;
  }

  return a.localeCompare(b);
}

/** A finding the page causes on purpose: it holds one of the page's marks. */
function isExpected(f: Finding, marks: readonly string[]): boolean {
  return (
    f.kind !== "expected" && marks.some((mark) => f.message.includes(mark))
  );
}

function print(pages: readonly string[]): number {
  const order = [...new Set([...pages, ...findings.keys()])].toSorted(
    serverLast
  );

  let total = 0;
  let withFindings = 0;

  for (const page of order) {
    const list = [...(findings.get(page) ?? [])];
    const marks = expected.get(page) ?? [];

    for (const mark of marks) {
      if (
        !list.some((f) => f.kind !== "expected" && f.message.includes(mark))
      ) {
        list.push({
          level: "error",
          kind: "expected",
          message: `the page expects a finding with "${mark}" (data-smoke-expect), and none came`,
        });
      }
    }

    // The same message from the same place, once, with a count.
    const seen = new Map<string, { finding: Finding; count: number }>();

    for (const finding of list) {
      const key = `${finding.level}|${finding.kind}|${finding.message}|${finding.at}`;
      const was = seen.get(key);

      if (was) {
        was.count += 1;
      } else {
        seen.set(key, { finding, count: 1 });
      }
    }

    const all = [...seen.values()];
    const counted = all.filter(({ finding }) => !isExpected(finding, marks));
    const known = all.filter(({ finding }) => isExpected(finding, marks));

    if (counted.length) {
      withFindings += 1;
      total += counted.length;
      console.log(
        `FAIL  ${page}  (${counted.length} finding${counted.length === 1 ? "" : "s"})`
      );
    } else {
      console.log(
        `ok    ${page}${known.length ? `  (${known.length} expected)` : ""}`
      );
    }

    for (const { finding: f, count } of [...counted, ...known]) {
      const times = count > 1 ? ` (x${count})` : "";
      const level = isExpected(f, marks) ? "expect" : f.level;
      console.log(
        `  ${level.padEnd(7)} ${f.kind.padEnd(10)} ${f.message}${times}`
      );

      if (f.at) {
        console.log(`      at ${f.at}`);
      }
    }
  }

  console.log(
    total
      ? `\n${total} finding${total === 1 ? "" : "s"} on ${withFindings} of ${order.length} page${order.length === 1 ? "" : "s"}.`
      : `\n${order.length} page${order.length === 1 ? "" : "s"}, nothing found.`
  );

  return total;
}

// ---------------------------------------------------------------------------

/** What the server HTML alone shows: boundaries, the marks of expected findings, and SEO. */
function checkServerHtml(pages: { path: string; html: string }[]) {
  for (const page of pages) {
    const boundaries = inspectBoundaries(page.html);

    if (boundaries.unresolved.length) {
      report(page.path, {
        level: "error",
        kind: "boundary",
        message: `<Loading> boundary never resolved in the server HTML (${boundaries.unresolved.join(", ")})`,
      });
    }

    if (boundaries.errored.length) {
      report(page.path, {
        level: "error",
        kind: "boundary",
        message: `<Loading> boundary errored in the server HTML (${boundaries.errored.join(", ")})`,
      });
    }

    const marks = expectedFindings(page.html);

    if (marks.length) {
      expected.set(page.path, marks);
    }

    if (site) {
      for (const finding of seoFindings(page.html)) {
        report(page.path, finding);
      }
    }
  }
}

async function run(chrome: Chrome): Promise<number> {
  const started = Date.now();
  // The first render compiles the app; what the server prints meanwhile is about `/`.
  current = "/";

  const answered = await ready().then(
    () => true,
    (error: Error) => {
      const cause =
        error.cause instanceof Error ? `: ${error.cause.message}` : "";

      report("/", {
        level: "error",
        kind: "status",
        message: `${error.message}${cause}`,
      });

      return false;
    }
  );

  const pages = answered ? await crawl() : [];

  checkServerHtml(pages);

  for (const page of pages) {
    current = page.path;

    if (page.status === 200) {
      // oxlint-disable-next-line no-await-in-loop -- the copy renders the page again, and what the server prints meanwhile belongs to it
      const finding = await markdownFinding(page.path);

      if (finding) {
        report(page.path, finding);
      }
    }

    // oxlint-disable-next-line no-await-in-loop -- one page at a time, so the server's output belongs to it
    const hydrated = await load(chrome, page.path);

    if (site && hydrated && page.status === 200) {
      const finding = clientOnlyFinding(page.html, hydrated);

      if (finding) {
        report(page.path, finding);
      }
    }

    process.stderr.write(".");
  }

  // One round trip is enough: the head of every hydrated page works the same way.
  let tripped = false;

  for (const page of pages) {
    current = page.path;
    const others = pages.map((p) => p.path).filter((p) => p !== page.path);
    // oxlint-disable-next-line no-await-in-loop -- until one page has a link to another
    tripped = await roundTrip(chrome, page.path, others);

    if (tripped) {
      break;
    }
  }

  // A note, not a finding: `--only` with one page is the usual run after a change.
  const untripped = !tripped && pages.length > 0;
  current = undefined;
  // What the server prints after the last page still belongs to it.
  await Bun.sleep(300);
  flushServer?.();
  process.stderr.write("\n");
  console.log(
    `smoke ${app} on ${origin}: ${pages.length} page${pages.length === 1 ? "" : "s"} in ${Math.round((Date.now() - started) / 1000)} s\n`
  );
  const found = print(pages.map((p) => p.path));

  if (untripped) {
    console.log(
      `\nThe head round trip did not run: ${pages.length === 1 ? "it needs a second crawled page" : "no page links to another crawled page"}.`
    );
  }

  return found;
}

/**
 * Loads every page of the app and prints the findings; gives 1 when there are any.
 */
export async function smoke(options: SmokeOptions): Promise<number> {
  ({ root, only, site } = options);
  appDir = options.dir;
  app = nodePath.relative(process.cwd(), appDir) || ".";
  requestedPort = options.port;

  process.once("SIGINT", () => {
    stopServer();
    process.exit(130);
  });

  origin = options.url?.replace(/\/$/u, "") || (await startServer());

  let chrome: Chrome | undefined;

  try {
    // Chrome first: when it cannot start, say so before the long part.
    chrome = await launchChrome();

    return (await run(chrome)) ? 1 : 0;
  } finally {
    stopServer();
    await chrome?.close();
  }
}
