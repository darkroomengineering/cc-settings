/** The Worker's entry, copied into the output with its types stripped, so it imports nothing (DESIGN.md). */

interface PlatformCache {
  tag: (tags: string[]) => void;
  purge: (tags: string[]) => Promise<void>;
}

// test/cloudflare.test.ts checks both against the packages that own them.
export const CACHE_FIELD = "visioCache";
export const BYPASS_COOKIE = "__prerender_bypass";
export const ENV_KEY: unique symbol = Symbol.for("@visio/cloudflare/env");

/** Workers Cache keeps at most this many tags on a response. */
export const MAX_TAGS = 1000;

/** What the browser gets for a cached page: ask again every time, so a purge reaches it. */
export const REVALIDATE = "public, max-age=0, must-revalidate";
const UNCACHED = "private, no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";

type HandleRequest = (
  request: Request,
  options: { event: { [CACHE_FIELD]: PlatformCache }; renderMode?: "async" }
) => Promise<Response>;

type Gate = (
  request: Request,
  options: { password: string; open?: readonly string[] }
) => Promise<Response | undefined>;

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SITE_PASSWORD?: string;
  VISIO_BYPASS_TOKEN?: string;
}

interface EnvHolder {
  [ENV_KEY]?: Env;
}

/** The env is the same for every request of an isolate, so one slot holds it. */
function share(env: Env) {
  // SAFETY: only this module and `binding()` use the key.
  (globalThis as EnvHolder)[ENV_KEY] = env;
}

interface PurgeResult {
  success: boolean;
  errors?: { code: number; message: string }[];
}

/** The cached entrypoint, as the gateway reaches it through `ctx.exports`. */
interface RenderStub {
  fetch: (
    request: Request,
    init?: { cf?: { cacheKey?: string } }
  ) => Promise<Response>;
  purge: (tags: string[]) => Promise<void>;
}

export interface Context {
  exports: { Render: RenderStub };
  waitUntil: (promise: Promise<unknown>) => void;
  cache?: { purge: (options: { tags: string[] }) => Promise<PurgeResult> };
}

/** What a request asked for, as the `observe` hook gets it. */
export type ObserveKind =
  | "page"
  | "markdown"
  | "llms"
  | "robots"
  | "sitemap"
  | "other";

export interface ObserveArgs<E = object> {
  request: Request;
  /** The status of the answer, after the gate, the cache and the render. */
  status: number;
  kind: ObserveKind;
  /** The page's path for a page or its Markdown copy, else the request's path. */
  path: string;
  env: E;
  ctx: { waitUntil: (promise: Promise<unknown>) => void };
}

/** The default export of the site's `observe` module. */
export type Observe<E = object> = (
  args: ObserveArgs<E>
) => void | Promise<void>;

/** Solid's endpoint for server functions (`visio/DESIGN.md`), not a page. */
const SERVER_FUNCTIONS = "/_server/";

type EntrypointClass = new (
  ctx: Context,
  env: Env
) => { ctx: Context; env: Env };

export interface WorkerOptions {
  /** The value of the `__prerender_bypass` cookie that skips the cache: draft mode. */
  bypassToken: string;
  /** Seconds Workers Cache serves a cached page or read before it renders it again. */
  expiration: number;
  /** The `prerendered()` reads the crawl saw, which Workers Cache keeps at their address. */
  reads: readonly string[];
  /** The routes Workers Cache keeps every path of, as regular expression sources. */
  patterns: readonly string[];
  /** The `live` pages and `api()` routes, which no pattern may take in. */
  uncached: readonly string[];
  /** The hashed assets, as a regular expression source (`hashedAsset()`). */
  hashed: string;
  headers: Record<string, string>;
  /** Where the Studio is served: every path under it is its `index.html`. */
  studioPath?: string | undefined;
  /** Set when the build had `SITE_PASSWORD`: every request goes through the gate first. */
  gate?: { open: readonly string[] } | undefined;
  /** Set when the site has an `observe` hook: the `api()` routes, which are not pages to it, and the files `run_worker_first` sends. */
  observe?: { api: readonly string[]; files: string } | undefined;
}

// Twins of packages/aeo/src/paths.ts, since this file imports nothing; test/twins.test.ts checks them.
const PAGE = /^\/(?:(?:[^/]+\/)*[^/.]+\/?)?$/u;

/** The page a Markdown copy is of, or the path itself. */
export function pageOf(pathname: string): string {
  if (!pathname.endsWith(".md")) {
    return pathname;
  }

  const page = pathname.slice(0, -3);

  return page === "/index" ? "/" : page;
}

export function markdownPath(pathname: string): string {
  return `${pathname.replace(/\/+$/u, "") || "/index"}.md`;
}

export function wantsMarkdown(url: URL, accept: string | null): boolean {
  return !!accept?.includes("text/markdown") && PAGE.test(url.pathname);
}

function dropVaryAccept(headers: Headers) {
  const vary = (headers.get("vary") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name.toLowerCase() !== "accept");

  if (vary.length) {
    headers.set("vary", vary.join(", "));
  } else {
    headers.delete("vary");
  }
}

function bypasses(request: Request, token: string): boolean {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");

    if (eq !== -1 && part.slice(0, eq).trim() === BYPASS_COOKIE) {
      return part.slice(eq + 1).trim() === token;
    }
  }

  return false;
}

/** A copy whose headers can change: `Response.redirect()` and `fetch()` give immutable ones. */
function mutable(response: Response): Response {
  return new Response(response.body, response);
}

function failure(): Response {
  return new Response("Internal Server Error", {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function misconfigured(message: string): Response {
  return new Response(message, {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function logged(promise: Promise<void>) {
  try {
    await promise;
  } catch (error) {
    console.error(error);
  }
}

/** `default`, the gateway with no cache in front, and `Render`, the entrypoint Workers Cache keeps. */
export function createWorker(
  handleRequest: HandleRequest,
  runtime: {
    WorkerEntrypoint: EntrypointClass;
    gate: Gate;
    observe?: Observe<Env>;
  },
  options: WorkerOptions
) {
  // Served stale while it renders again, as Vercel does after the expiration.
  const cached = `public, max-age=${options.expiration}, stale-while-revalidate=86400`;
  const reads = new Set(options.reads);
  const patterns = options.patterns.map((source) => new RegExp(source, "u"));
  const uncached = options.uncached.map((source) => new RegExp(source, "u"));

  function cacheable(pathname: string) {
    return (
      reads.has(pathname) ||
      (!uncached.some((p) => p.test(pathname)) &&
        patterns.some((p) => p.test(pathname)))
    );
  }

  const hashed = new RegExp(options.hashed, "u");
  const studio = options.studioPath?.replace(/\/$/u, "");
  const observed = options.observe && new RegExp(options.observe.files, "u");

  const api = (options.observe?.api ?? []).map(
    (source) => new RegExp(source, "u")
  );

  function inStudio(pathname: string) {
    return (
      studio !== undefined &&
      (pathname === studio || pathname.startsWith(`${studio}/`))
    );
  }

  async function render(
    request: Request,
    cache: PlatformCache,
    inOrder: boolean
  ) {
    const handleOptions: Parameters<HandleRequest>[1] = {
      event: { [CACHE_FIELD]: cache },
    };

    if (inOrder) {
      handleOptions.renderMode = "async";
    }

    try {
      return await handleRequest(request, handleOptions);
    } catch (error) {
      // The handler answers a failure with a 500 itself; this is for one that escapes it.
      console.error(error);

      return failure();
    }
  }

  /** The entrypoint whose responses Workers Cache keeps, under the tags their reads added. */
  class Render extends runtime.WorkerEntrypoint {
    async fetch(request: Request): Promise<Response> {
      share(this.env);
      const tags = new Set<string>();

      const cache: PlatformCache = {
        tag: (list) => {
          for (const tag of list) {
            tags.add(tag);
          }
        },
        purge: (list) => this.purge(list),
      };

      // Every read has settled before the response exists, so its tags are known.
      const response = mutable(await render(request, cache, true));
      // The key holds the format, and Workers Cache compares a Vary value verbatim.
      dropVaryAccept(response.headers);
      const control = response.headers.get("cache-control");

      // A read answers `no-store` unless it set its own header.
      const read =
        reads.has(new URL(request.url).pathname) && control === "no-store";

      if (control !== null && !read) {
        return response;
      }

      // RFC 9111 lets a cache keep a 404 with no header at all, and a cookie is one visitor's.
      if (response.status !== 200 || response.headers.has("set-cookie")) {
        response.headers.set("cache-control", UNCACHED);

        return response;
      }

      if (tags.size > MAX_TAGS) {
        // Kept with some tags only, a publish of the others would never reach it.
        console.warn(
          `[@visio/cloudflare] ${new URL(request.url).pathname} read ${tags.size} Sanity documents, more than the ${MAX_TAGS} cache tags Workers Cache keeps on a response, so it is not cached. Read fewer documents on the page.`
        );
        response.headers.set("cache-control", UNCACHED);

        return response;
      }

      response.headers.set("cache-control", cached);

      if (tags.size) {
        response.headers.set("cache-tag", [...tags].join(","));
      }

      return response;
    }

    /** A purge only reaches the entrypoint that stored the responses, so the gateway calls this. */
    async purge(tags: string[]): Promise<void> {
      if (!this.ctx.cache) {
        throw new Error(
          "[@visio/cloudflare] Workers Cache is not on for this Worker (`wrangler dev` has none), so the purge did not happen."
        );
      }

      const result = await this.ctx.cache.purge({ tags });

      if (!result.success) {
        throw new Error(
          `[@visio/cloudflare] Workers Cache refused the purge: ${(result.errors ?? []).map((e) => e.message).join("; ") || "no reason given"}`
        );
      }
    }
  }

  /** The answer before any page renders: a misconfiguration, the gate, a file behind the gate, or an aeo file for the hook. */
  async function guard(
    request: Request,
    env: Env,
    url: URL,
    read: boolean
  ): Promise<Response | undefined> {
    if (env.VISIO_BYPASS_TOKEN !== options.bypassToken) {
      return misconfigured(
        "[@visio/cloudflare] VISIO_BYPASS_TOKEN of this Worker is not the token of its build, so draft mode cannot work. The build writes it into `vars` and `previews.vars` of dist/cloudflare/wrangler.json: deploy that file as built, with Wrangler 4.135.0 or later."
      );
    }

    if (options.gate) {
      if (!env.SITE_PASSWORD) {
        return misconfigured(
          "SITE_PASSWORD is not set for this Worker. Add it as a secret."
        );
      }

      const answer = await runtime.gate(request, {
        password: env.SITE_PASSWORD,
        open: options.gate.open,
      });

      if (answer) {
        return answer;
      }
    }

    // With the gate every request comes here first, files included; with a hook, the aeo files.
    if (read && (options.gate || observed?.test(url.pathname))) {
      const asset = await env.ASSETS.fetch(request);

      if (asset.status !== 404) {
        if (!hashed.test(url.pathname)) {
          return asset;
        }

        const immutable = mutable(asset);
        immutable.headers.set("cache-control", IMMUTABLE);

        return immutable;
      }

      await asset.body?.cancel();
    }

    return undefined;
  }

  async function route(
    request: Request,
    env: Env,
    ctx: Context
  ): Promise<Response> {
    const url = new URL(request.url);
    const read = request.method === "GET" || request.method === "HEAD";
    const guarded = await guard(request, env, url, read);

    if (guarded) {
      return guarded;
    }

    if (studio && read && inStudio(url.pathname)) {
      return env.ASSETS.fetch(
        new Request(new URL(`${studio}/index.html`, url), request)
      );
    }

    const draft = bypasses(request, options.bypassToken);

    const gateway: PlatformCache = {
      tag: () => {
        // Nothing the gateway answers is cached.
      },
      purge: (tags) => ctx.exports.Render.purge(tags),
    };

    if (draft) {
      const response = mutable(await render(request, gateway, false));
      // Drafts are for the editor alone: no cache on the way may keep them.
      response.headers.set("cache-control", UNCACHED);

      return response;
    }

    const isRead = reads.has(url.pathname);
    const page = isRead ? url.pathname : pageOf(url.pathname);

    if (!read || !cacheable(page)) {
      return render(request, gateway, false);
    }

    // A copy's key is its `.md` path: DESIGN.md, Markdown copies.
    const copy =
      !isRead &&
      (page !== url.pathname ||
        wantsMarkdown(url, request.headers.get("accept")));

    const target = copy ? new URL(markdownPath(page) + url.search, url) : url;
    const forwarded = new Request(target, request);
    // Workers Cache skips the cache for a request with this header.
    forwarded.headers.delete("authorization");

    if (!isRead) {
      forwarded.headers.set("accept", "text/html");
    }

    // A page's key is its path, as on Vercel: `?utm_source=` renders nothing again.
    // A read's query is its arguments, so it stays in the key.
    const key = isRead ? undefined : `${target.origin}${target.pathname}`;

    const response = mutable(
      await ctx.exports.Render.fetch(
        forwarded,
        key ? { cf: { cacheKey: key } } : undefined
      )
    );

    response.headers.delete("cache-tag");

    if (response.headers.get("cache-control") === cached) {
      response.headers.set("cache-control", REVALIDATE);
    }

    return response;
  }

  function kindOf(request: Request): Pick<ObserveArgs, "kind" | "path"> {
    const url = new URL(request.url);
    const { pathname } = url;
    const page = pageOf(pathname);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return { kind: "other", path: pathname };
    }

    if (pathname === "/robots.txt") {
      return { kind: "robots", path: pathname };
    }

    if (pathname === "/llms.txt") {
      return { kind: "llms", path: pathname };
    }

    if (observed?.test(pathname)) {
      return { kind: "sitemap", path: pathname };
    }

    if (
      inStudio(pathname) ||
      pathname.startsWith(SERVER_FUNCTIONS) ||
      // The router's matcher drops empty segments, so `/api/me/` is still the api() route.
      api.some((p) => p.test(page.replace(/\/+$/u, "") || "/")) ||
      !PAGE.test(page)
    ) {
      return { kind: "other", path: pathname };
    }

    if (
      page !== pathname ||
      wantsMarkdown(url, request.headers.get("accept"))
    ) {
      return { kind: "markdown", path: page };
    }

    return { kind: "page", path: pathname };
  }

  function observe(
    hook: Observe<Env>,
    request: Request,
    status: number,
    env: Env,
    ctx: Context
  ) {
    try {
      const result = hook({
        request,
        status,
        ...kindOf(request),
        env,
        ctx,
      });

      if (result) {
        ctx.waitUntil(logged(result));
      }
    } catch (error) {
      console.error(error);
    }
  }

  const worker = {
    async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
      share(env);
      const response = await respond(request, env, ctx);

      if (runtime.observe) {
        observe(runtime.observe, request, response.status, env, ctx);
      }

      return response;
    },
  };

  async function respond(
    request: Request,
    env: Env,
    ctx: Context
  ): Promise<Response> {
    let response: Response;

    try {
      response = await route(request, env, ctx);
    } catch (error) {
      console.error(error);
      response = failure();
    }

    // A WebSocket answer cannot be copied, and is not a page.
    if (response.status === 101) {
      return response;
    }

    // A file the gate let through and every response of the Worker: `_headers` reaches neither.
    response = mutable(response);

    for (const [name, value] of Object.entries(options.headers)) {
      response.headers.set(name, value);
    }

    return response;
  }

  return { worker, Render };
}
