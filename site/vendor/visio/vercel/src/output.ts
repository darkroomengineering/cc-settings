import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { MARKDOWN, markdownPath } from "@visio/aeo/internal/vite";
import { isDynamic, patternSource } from "@visio/router/internal/vite";
import {
  buildDirs,
  buildPlugins,
  cachedPaths,
  copyClient,
  EXPIRATION,
  escapeRegExp,
  gated,
  hashedAsset,
  LIST_TYPES,
  liveLists,
  NO_CAPTURE,
  recordCrawl,
  SECURITY_HEADERS,
  writeJson,
} from "visio/internal/deploy";
import type {
  DeployFacts,
  DeployOutput,
  JsonObject,
} from "visio/internal/deploy";
import { transformWithOxc } from "vite";
import type { Plugin } from "vite";

import { gateRoute, writeGate } from "./gate.ts";
import { PATHNAME } from "./runtime.ts";
import type { HandlerOptions } from "./runtime.ts";

const RENDER = "_render";

/** Where the function that caches the paths of a dynamic route is: `_routes/0`. */
const ROUTES_DIR = "_routes";

/** The function name a path is served under: `/` is `index`, `/work/a` is `work/a`. */
function functionName(pathname: string): string {
  return pathname === "/" ? "index" : pathname.replaceAll(/^\/+|\/+$/gu, "");
}

const SERVER = "/_server";

/** The Markdown copies of a pattern's pages (`@visio/aeo`): `/work/a.md`, `/index.md` for `/`. */
export function markdownSource(pattern: string): string {
  const source = patternSource(pattern);
  const inner = source.slice(1, -1);

  return new RegExp(source, "u").test("/")
    ? `^(?:/index|${inner})\\.md$`
    : `^${inner}\\.md$`;
}

export function markdownRoutes(exclude: readonly string[]): JsonObject[] {
  const not = exclude
    .values()
    .map((p) => escapeRegExp(p.replaceAll(/^\/|\/$/gu, "")))
    .filter(Boolean)
    .map((p) => `(?!${p}(?:/|$))`)
    .toArray()
    .join("");

  const has = [
    { type: "header", key: "accept", value: `.*${escapeRegExp(MARKDOWN)}.*` },
  ];

  return [
    // Ahead of the rewrites, which would hide the page path from it.
    {
      src: `^/${not}(?:(?:[^/]+/)*[^/.]+/?)?$`,
      headers: { vary: "Accept" },
      continue: true,
    },
    { src: "^/$", has, dest: "/index.md", check: true },
    { src: `^/${not}((?:[^/]+/)*[^/.]+)/?$`, has, dest: "/$1.md", check: true },
  ];
}

/** The routes of `config.json`, in the order Vercel applies them. */
function routes(options: {
  assets: string;
  studioPath?: string | undefined;
  gate: boolean;
  /** The dynamic patterns a cache may keep, each with its own function. */
  dynamic: readonly string[];
  /** The patterns that answer per request, which no dynamic route may take in. */
  uncached: readonly string[];
}): JsonObject[] {
  function toRender(source: string) {
    return { src: source, dest: `/${RENDER}` };
  }

  const studio = options.studioPath?.replace(/\/$/u, "");

  return [
    // First, ahead of static files and the cache.
    ...(options.gate ? [gateRoute()] : []),
    // A cached page is answered from the cache, so the function's middleware
    // cannot set these. Vercel sends `strict-transport-security` itself.
    { src: "^/(.*)$", headers: SECURITY_HEADERS, continue: true },
    ...markdownRoutes([SERVER, ...(studio ? [studio] : [])]),
    // Static files, then the cached functions, which live at their own path.
    { handle: "filesystem" },
    // The Studio is a single-page app: every path under it is its index.
    ...(studio
      ? [
          {
            src: `^${escapeRegExp(studio)}(?:/.*)?$`,
            dest: `${studio}/index.html`,
          },
        ]
      : []),
    // Ahead of the dynamic routes, whose patterns may take these in.
    ...(options.dynamic.length
      ? [
          ...options.uncached.flatMap((p) => [
            patternSource(p),
            markdownSource(p),
          ]),
          `^${SERVER}(?:/.*)?$`,
        ].map(toRender)
      : []),
    ...options.dynamic.flatMap((pattern, i) =>
      [patternSource(pattern), markdownSource(pattern)].map((source) => ({
        src: `^(${source.slice(1, -1)})$`,
        dest: `/${ROUTES_DIR}/${i}?${PATHNAME}=$1`,
      }))
    ),
    { src: "^/(.*)$", dest: `/${RENDER}` },
    // Only for a file that exists: a header set before `filesystem` sticks to
    // the 404 of a missing old chunk, which would then be cached a year.
    { handle: "hit" },
    {
      src: hashedAsset(options.assets),
      headers: { "cache-control": "public, max-age=31536000, immutable" },
      continue: true,
    },
  ];
}

/** Another path for the one function: a `.func` may be a link to another. */
function linkFunction(functions: string, name: string) {
  const at = path.join(functions, `${name}.func`);
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(
    path.relative(path.dirname(at), path.join(functions, `${RENDER}.func`)),
    at
  );
}

async function writeFunction(
  dir: string,
  ssrOut: string,
  options: HandlerOptions,
  lists: string
) {
  cpSync(ssrOut, path.join(dir, "server"), { recursive: true });
  const source = readFileSync(new URL("runtime.ts", import.meta.url), "utf-8");
  const runtime = await transformWithOxc(source, "runtime.ts", { lang: "ts" });
  writeFileSync(path.join(dir, "runtime.mjs"), runtime.code);
  writeFileSync(
    path.join(dir, "index.mjs"),
    [
      `import { createHandler } from './runtime.mjs';`,
      `import { handleRequest } from './server/server.js';`,
      lists,
      `export default createHandler(handleRequest, ${JSON.stringify(options)});`,
      "",
    ].join("\n")
  );
  writeJson(path.join(dir, "package.json"), { type: "module" });
  writeJson(path.join(dir, ".vc-config.json"), {
    runtime: "nodejs22.x",
    handler: "index.mjs",
    launcherType: "Nodejs",
    supportsResponseStreaming: true,
    // Server code sets the bypass cookie with it when draft mode starts.
    environment: { VISIO_BYPASS_TOKEN: options.bypassToken },
  });
}

/**
 * A crawl integration that records pages and `prerendered()` reads, and the
 * plugins that build the server self-contained and write `.vercel/output`.
 */
export function vercelOutput(options: DeployFacts = {}): DeployOutput {
  const { crawl, integration } = recordCrawl("visio:vercel");

  const plugins: Plugin[] = [
    ...buildPlugins("Vercel"),
    {
      name: "visio:vercel:output",
      apply: "build",
      buildApp: {
        // After the crawl, which is `post` too and comes first.
        order: "post",
        async handler(builder) {
          const { root, logger } = builder.config;
          const gate = gated();
          const { assetsDir, clientOut, ssrOut } = buildDirs(builder);
          const out = path.join(root, ".vercel/output");
          const functions = path.join(out, "functions");
          rmSync(out, { recursive: true, force: true });

          copyClient(clientOut, path.join(out, "static"));

          const { pages, reads } = cachedPaths(crawl);
          // New every build, so a deploy ends every draft session.
          const bypassToken = randomBytes(32).toString("hex");
          const dynamic = (options.routes?.cached ?? []).filter(isDynamic);
          const copies = pages.map((p) => markdownPath(p.path));
          const lists = liveLists(options.lists?.());

          await writeFunction(
            path.join(functions, `${RENDER}.func`),
            ssrOut,
            {
              bypassToken,
              cached: [
                ...pages.map((p) => p.path),
                ...copies,
                ...reads,
                ...lists.paths,
              ],
              patterns: dynamic.map(patternSource),
            },
            lists.line
          );

          // The crawl's file seeds the cached function, as a page's HTML does.
          for (const list of lists.paths) {
            const file = path.join(out, "static", list.slice(1));
            const name = list.slice(1);
            const fallback = `${name}.prerender-fallback${path.extname(name)}`;
            linkFunction(functions, name);
            writeFileSync(path.join(functions, fallback), readFileSync(file));
            rmSync(file);
            writeJson(path.join(functions, `${name}.prerender-config.json`), {
              expiration: EXPIRATION,
              bypassToken,
              fallback,
              allowQuery: [],
              initialHeaders: { "content-type": LIST_TYPES[list] },
            });
          }

          for (const page of pages) {
            const name = functionName(page.path);
            linkFunction(functions, name);
            const fallback = `${path.basename(name)}.prerender-fallback.html`;
            const link = page.response.headers.get("link");
            writeFileSync(
              path.join(functions, path.dirname(name), fallback),
              page.html
            );
            writeJson(path.join(functions, `${name}.prerender-config.json`), {
              expiration: EXPIRATION,
              bypassToken,
              fallback,
              allowQuery: [],
              initialHeaders: {
                "content-type": "text/html; charset=utf-8",
                ...(link && { link }),
              },
            });
          }

          for (const copy of copies) {
            const name = copy.slice(1);
            linkFunction(functions, name);
            writeJson(path.join(functions, `${name}.prerender-config.json`), {
              expiration: EXPIRATION,
              bypassToken,
              allowQuery: [],
            });
          }

          for (const read of reads) {
            const name = functionName(read);
            linkFunction(functions, name);
            writeJson(path.join(functions, `${name}.prerender-config.json`), {
              expiration: EXPIRATION,
              bypassToken,
              // The call's arguments are its address.
              allowQuery: ["args"],
              passQuery: true,
            });
          }

          for (const [i] of dynamic.entries()) {
            const name = `${ROUTES_DIR}/${i}`;
            linkFunction(functions, name);
            writeJson(path.join(functions, `${name}.prerender-config.json`), {
              expiration: EXPIRATION,
              bypassToken,
              allowQuery: [PATHNAME],
              passQuery: true,
            });
          }

          if (gate) {
            await writeGate(functions, options.open ?? []);
          }

          writeJson(path.join(out, "config.json"), {
            version: 3,
            routes: routes({
              assets: `/${assetsDir}`,
              studioPath: options.studioPath,
              gate,
              dynamic,
              uncached: options.routes?.uncached ?? [],
            }),
          });

          if (!crawl.captured) {
            logger.warn(NO_CAPTURE);
          }

          logger.info(
            `[@visio/vercel] Vercel output: ${pages.length} cached page(s) with their Markdown copies, ${dynamic.length} cached dynamic route(s), ${reads.length} cached read(s)${gate ? ", behind the password gate" : ""} -> ${path.relative(root, out)}`
          );
        },
      },
    },
  ];

  return { integration, plugins };
}
