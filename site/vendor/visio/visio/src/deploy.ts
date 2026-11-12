import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

import type { EnvPlatform } from "@visio/env/internal/platform";
import { PASSWORD_VAR } from "@visio/gate/internal/gate";
import type { RouteFacts } from "@visio/router/internal/vite";
import type { PrerenderIntegration, RenderedPage } from "prerender-crawler";
import type { Plugin, ResolvedConfig } from "vite";

import type { JsonValue } from "./json.ts";
import { listPaths, LISTS } from "./lists-facts.ts";
import type { BuildLists, ListPath } from "./lists-facts.ts";

export { LIST_TYPES } from "./lists-facts.ts";

export type { JsonObject, JsonValue } from "./json.ts";

export { compareVersions, installedVersion } from "./versions.ts";

/** The branch Workers Builds deploys to production, unless `VISIO_PRODUCTION_BRANCH` names another. */
export const PRODUCTION_BRANCH = "main";

/**
 * The branch of a Workers Builds build that is not the production branch,
 * or none: Workers Builds names the branch, but not which one is production.
 */
export function previewBranch(
  env: Record<string, string | undefined>
): string | undefined {
  const branch = env.WORKERS_CI_BRANCH;

  if (!branch) {
    return undefined;
  }

  return branch === (env.VISIO_PRODUCTION_BRANCH || PRODUCTION_BRANCH)
    ? undefined
    : branch;
}

/** Where the build deploys: the call of a deploy package, such as `vercel()` of `@visio/vercel`. */
export interface Deployment {
  /** A module whose default export is a middleware, put on the chain after the crawl's. */
  readonly middleware?: string | undefined;
  /** The crawl integration and the plugins that write the output, with the facts `visio()` holds. */
  readonly output: (facts: DeployFacts) => DeployOutput;
  /** Where `bun run env:push` writes the values, and how the build tells its target. */
  readonly env?: EnvPlatform | undefined;
}

export interface DeployOutput {
  /** Records what the crawl rendered; the last integration of the crawl. */
  readonly integration: PrerenderIntegration;
  /** Last in the plugin list: the output is written after the crawl. */
  readonly plugins: readonly Plugin[];
}

/** What `visio()` hands the output. */
export interface DeployFacts {
  /** Where the Studio is served, when the site has one: every path under it is its `index.html`. */
  studioPath?: string | undefined;
  /** Paths the password gate lets through. */
  open?: readonly string[] | undefined;
  /** The route table's facts, filled before the output is written. */
  routes?: RouteFacts | undefined;
  /** The build's lists once the crawl ended; with them, the server answers `/sitemap.xml` and `/llms.txt` (`liveLists`). */
  lists?: (() => BuildLists | undefined) | undefined;
}

/** The line of the deployment's entry that hands the server the build's lists, and the paths it then answers. */
export interface LiveLists {
  /** The line of the entry, before the server's first request. */
  line: string;
  paths: ListPath[];
}

export function liveLists(lists?: BuildLists): LiveLists {
  if (!lists) {
    return { line: "", paths: [] };
  }

  return {
    line: `globalThis[Symbol.for(${JSON.stringify(LISTS.description)})] = ${JSON.stringify(lists)};`,
    paths: listPaths(lists),
  };
}

/** Whether the build has `SITE_PASSWORD`, which puts the password gate in front of the output. */
export function gated(): boolean {
  return Boolean(process.env[PASSWORD_VAR]);
}

const TARGETS = { vercel: "@visio/vercel", cloudflare: "@visio/cloudflare" };

const TARGET_FIX = `Write \`deploy: vercel()\` from ${TARGETS.vercel}, or \`deploy: cloudflare()\` from ${TARGETS.cloudflare}, in vite.config.ts (.claude/skills/visio/SKILL.md).`;

/** A deploy package's call, and not the string `deploy` took until 2026-10-13. */
export function checkDeploy(options: { deploy?: unknown }): void {
  const { deploy } = options;

  if (deploy === "vercel" || deploy === "cloudflare") {
    const pkg = TARGETS[deploy];
    throw new Error(
      `[visio] [DEPLOY_NEEDS_PACKAGE] deploy: '${deploy}' is gone: each target is its own package. Add "${pkg}": "workspace:*" to the site's dependencies, then write \`deploy: ${deploy}()\` with \`import { ${deploy} } from "${pkg}"\` in vite.config.ts.`
    );
  }

  if (deploy === undefined) {
    throw new Error(
      `[visio] [DEPLOY_MISSING] visio() has no deploy. ${TARGET_FIX}`
    );
  }

  if (typeof deploy === "function") {
    throw new TypeError(
      `[visio] [DEPLOY_NOT_CALLED] deploy is the function ${deploy.name || "of a deploy package"}, not its call. Write \`deploy: ${deploy.name || "vercel"}()\`.`
    );
  }

  if (typeof deploy !== "object" || deploy === null || !("output" in deploy)) {
    throw new TypeError(
      `[visio] [DEPLOY_UNKNOWN] deploy is ${JSON.stringify(deploy)}, which is not the call of a deploy package. ${TARGET_FIX}`
    );
  }
}

/** Seconds a cached page is served before it renders again; bounds how stale a page a publish purge missed can get. */
export const EXPIRATION = 60 * 60;

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

const ENDPOINT = "/_server";
const CAPTURE_SINK = Symbol.for("solid-prerender.captureArtifacts");

interface Sink {
  capture: (
    id: string,
    args: unknown[],
    value: unknown,
    url: string
  ) => Promise<void> | void;
}

export interface Crawl {
  pages: readonly RenderedPage[];
  /** The ids of the `prerendered()` server functions the pages called. */
  reads: Set<string>;
  /** Whether the crawl had the server-function capture to record the reads with. */
  captured: boolean;
}

/**
 * Cacheable: an HTML 200 for everyone, with no redirect, cookie, or
 * `private` or `no-store`. The cache serves a cached page as HTML.
 */
export function cacheable(page: RenderedPage): boolean {
  const { response } = page;

  if (page.redirect || response.status !== 200) {
    return false;
  }

  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return false;
  }

  if (response.headers.has("set-cookie")) {
    return false;
  }

  return !/\b(?:private|no-store)\b/u.test(
    response.headers.get("cache-control") ?? ""
  );
}

/** Must match the URL @solidjs/web builds for a GET server function. */
export function readPath(id: string): string {
  return `${ENDPOINT}/data/${encodeURIComponent(id)}`;
}

export function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A file under `assets` with a content hash in its name, `name-HASH.ext`. */
export function hashedAsset(assets: string): string {
  return `^${escapeRegExp(assets)}/[^/]*-[A-Za-z0-9_-]{8}\\.[^/]+$`;
}

export function writeJson(file: string, value: JsonValue) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * A crawl integration that records the pages and, after the server-function
 * capture set its sink, the id of every `prerendered()` call on the way through.
 */
export function recordCrawl(name: string) {
  const crawl: Crawl = { pages: [], reads: new Set(), captured: false };

  const integration: PrerenderIntegration = {
    name,
    setup() {
      // SAFETY: the capture of @solidjs/prerender sets this global, and the package declares no type for it.
      const globals = globalThis as { [CAPTURE_SINK]?: Sink };
      const sink = globals[CAPTURE_SINK];
      crawl.reads = new Set();
      crawl.captured = sink !== undefined;

      if (!sink) {
        return;
      }

      globals[CAPTURE_SINK] = {
        capture(id, args, value, url) {
          crawl.reads.add(id);

          return sink.capture(id, args, value, url);
        },
      };
    },
    teardown(context) {
      crawl.pages = context.pages;
    },
  };

  return { crawl, integration };
}

/** The paths the cache keeps: the crawled pages it may cache, and the `prerendered()` reads they made. */
export function cachedPaths(crawl: Crawl) {
  return {
    pages: crawl.pages.filter(cacheable),
    reads: [...crawl.reads].map(readPath),
  };
}

export const NO_CAPTURE =
  "[visio] The crawl had no server-function capture, so no prerendered() reads are cached: each one reaches the server.";

/**
 * Bun counts its own `undici` and `ws` as built-ins, and Vite asks the
 * runtime, so a build under Bun would leave them as imports the deployed
 * server cannot resolve.
 */
const BUN_ONLY = new Set(["bun", "undici", "ws"]);

const NODE_BUILTINS = [
  ...builtinModules.filter((id) => !id.includes(":") && !BUN_ONLY.has(id)),
  /^node:/u,
];

interface Builder {
  config: ResolvedConfig;
  environments: Record<string, { config: ResolvedConfig } | undefined>;
}

/** Where the client and the server build went, and the client's assets directory. */
export function buildDirs(builder: Builder) {
  const { root } = builder.config;
  const client = builder.environments.client?.config.build;
  const ssr = builder.environments.ssr?.config.build;

  return {
    assetsDir: client?.assetsDir ?? "assets",
    clientOut: path.resolve(root, client?.outDir ?? "dist/client"),
    ssrOut: path.resolve(root, ssr?.outDir ?? "dist/server"),
  };
}

/** The client build without the baked artifacts: the client's reads go to the server. */
export function copyClient(clientOut: string, to: string) {
  cpSync(clientOut, to, {
    recursive: true,
    filter: (file) => !/[/\\](?:_static|\.vite)(?:[/\\]|$)/u.test(file),
  });
}

function baseError(target: string, base: string): string {
  return `[visio] The build writes the ${target} output, which does not support a Vite \`base\` other than '/' (got '${base}'). Set \`base: '/'\`.`;
}

/**
 * The server bundled with every package it imports, the client's
 * `prerendered()` reads sent to the server, and the base both outputs need.
 */
export function buildPlugins(target: string): Plugin[] {
  return [
    {
      name: "visio:deploy:config",
      apply: "build",
      configEnvironment(name) {
        // The server ships without node_modules.
        if (name === "ssr") {
          return { resolve: { noExternal: true, builtins: NODE_BUILTINS } };
        }

        // With no prerender mode, the client's prerendered() is a plain GET
        // of the server function, which the cache keeps at its address.
        if (name === "client") {
          return { define: { "import.meta.env.PRERENDER_MODE": "undefined" } };
        }
      },
      // The client build is served from `/`, so the pages would ask for
      // every asset at a path that does not exist.
      configResolved({ base }) {
        if (base !== "/") {
          throw new Error(baseError(target, base));
        }
      },
    },
    {
      // The dev server serves any base, so say now what the build will refuse.
      name: "visio:deploy:dev",
      apply: "serve",
      configResolved({ base, logger }) {
        if (base !== "/") {
          logger.warn(
            `${baseError(target, base)} The dev server runs; the build will stop.`
          );
        }
      },
    },
  ];
}
