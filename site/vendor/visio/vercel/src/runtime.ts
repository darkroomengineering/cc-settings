/**
 * The entry of the site's Vercel function: a Node `(req, res)` handler around
 * the built `handleRequest`. The build strips the types and copies this file
 * into the function next to the server bundle, so it imports nothing but Node.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The built handler, called with the Node request as `nativeEvent`, as Solid's Node listener does. */
type HandleRequest = (
  request: Request,
  options: { event: { nativeEvent: IncomingMessage }; renderMode?: "async" }
) => Promise<Response>;

export interface HandlerOptions {
  /** The value of the `__prerender_bypass` cookie that skips Vercel's cache. */
  bypassToken: string;
  /** The paths Vercel caches: the crawled pages and the `prerendered()` reads. */
  cached: readonly string[];
  /** The dynamic routes Vercel caches every path of, as regular expression sources. */
  patterns?: readonly string[] | undefined;
}

/** The query parameter a dynamic route's function gets the visitor's path in. */
export const PATHNAME = "__pathname";

// Only a dynamic route's function may take it: at `_render`, a request the gate
// lets through (`/api/sanity/revalidate?__pathname=/secret`) would render any page.
const ROUTE_FUNCTION = /^\/_routes\/\d+$/u;

// Twin of BYPASS_COOKIE in packages/sanity/src/constants.ts; this file imports only Node.
export const BYPASS_COOKIE = "__prerender_bypass";

/**
 * The visitor's path out of the query, and the rest of the query as it was
 * sent: `URLSearchParams` would write it again (`%20` as `+`).
 */
export function takePathname(search: string): TakenPathname {
  const prefix = `${PATHNAME}=`;
  const parts = search.replace(/^\?/u, "").split("&");

  for (const [at, part] of parts.entries()) {
    if (part.startsWith(prefix)) {
      const rest = parts
        .filter((other, i) => i !== at && other !== "")
        .join("&");

      return {
        pathname: decodeURIComponent(part.slice(prefix.length)),
        search: rest ? `?${rest}` : "",
      };
    }
  }

  return { search };
}

interface TakenPathname {
  pathname?: string;
  search: string;
}

function toRequest(req: IncomingMessage) {
  const [proto] = String(req.headers["x-forwarded-proto"] ?? "https").split(
    ","
  );

  const url = new URL(
    req.url ?? "/",
    `${proto}://${req.headers.host ?? "localhost"}`
  );

  // Vercel calls the home page's function, `index`, with the path `/index`.
  if (url.pathname === "/index") {
    url.pathname = "/";
  }

  // A dynamic route's function sees its own path; the visitor's is in the query.
  const taken = ROUTE_FUNCTION.test(url.pathname)
    ? takePathname(url.search)
    : { search: url.search };

  if (taken.pathname !== undefined) {
    url.pathname = taken.pathname;
    url.search = taken.search;
  }

  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2 pseudo-headers (`:path`) are not headers a Request can carry.
    if (value === undefined || name.startsWith(":")) {
      continue;
    }

    for (const one of Array.isArray(value) ? value : [value]) {
      headers.append(name, one);
    }
  }

  const method = req.method ?? "GET";

  const init: RequestInit & { duplex: "half" } = {
    method,
    headers,
    duplex: "half",
  };

  if (method !== "GET" && method !== "HEAD") {
    // SAFETY: Node types its web stream apart from the global one, and they are the same class at runtime.
    init.body = Readable.toWeb(req) as never;
  }

  return {
    request: new Request(url, init),
    routed: taken.pathname !== undefined,
  };
}

/** The page a Markdown copy (`@visio/aeo`) is of, or the path itself. A twin of `pagePath()` there, as this file imports only Node: test/twins.test.ts. */
export function pageOf(pathname: string): string {
  if (!pathname.endsWith(".md")) {
    return pathname;
  }

  const page = pathname.slice(0, -3);

  return page === "/index" ? "/" : page;
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

async function send(
  response: Response,
  req: IncomingMessage,
  res: ServerResponse
) {
  res.statusCode = response.status;

  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") {
      res.setHeader(name, value);
    }
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length) {
    res.setHeader("set-cookie", cookies);
  }

  if (!response.body || req.method === "HEAD") {
    if (response.body) {
      discard(response.body);
    }

    res.end();

    return;
  }

  // SAFETY: Node types its web stream apart from the global one, and they are the same class at runtime.
  const body = Readable.fromWeb(response.body as never);

  try {
    await pipeline(body, res);
  } finally {
    // To a response already closed, pipeline() fails without destroying its
    // source, and the render would go on for no one.
    body.destroy();
  }
}

/** A visitor who left: no error. */
const LEFT = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_UNABLE_TO_PIPE",
]);

async function discard(body: ReadableStream<Uint8Array>) {
  try {
    await body.cancel();
  } catch {
    // Nobody reads the body, so a failed cancel loses nothing.
  }
}

export function createHandler(
  handleRequest: HandleRequest,
  options: HandlerOptions
) {
  const cached = new Set(options.cached);

  const patterns = (options.patterns ?? []).map(
    (source) => new RegExp(source, "u")
  );

  return async (req: IncomingMessage, res: ServerResponse) => {
    const { request, routed } = toRequest(req);
    const { pathname } = new URL(request.url);
    const draft = bypasses(request, options.bypassToken);
    // A crawled path has a function of its own; any other path of a dynamic route shares one.
    // Only a dynamic route's own function is cached; the same path at `_render` is not.
    const page = pageOf(pathname);
    const shared = routed && patterns.some((pattern) => pattern.test(page));
    const caching = !draft && (cached.has(pathname) || shared);
    let response: Response;

    try {
      const handleOptions: Parameters<HandleRequest>[1] = {
        event: { nativeEvent: req },
      };

      if (caching) {
        handleOptions.renderMode = "async";
      }

      response = await handleRequest(request, handleOptions);
    } catch (error) {
      // The handler answers a failure with a 500 itself; this is for one that escapes it.
      console.error(error);
      response = new Response("Internal Server Error", { status: 500 });
    }

    try {
      // Rebuilt, since `Response.redirect()` and `fetch()` give immutable headers.
      if (caching || draft) {
        response = new Response(response.body, response);
      }

      // A server function answers `no-store` unless it set its own header,
      // which would keep Vercel from caching a `prerendered()` read.
      if (
        caching &&
        cached.has(pathname) &&
        response.headers.get("cache-control") === "no-store"
      ) {
        response.headers.delete("cache-control");
      }

      // Drafts are for the editor alone: no cache on the way may keep them.
      if (draft) {
        response.headers.set("cache-control", "private, no-store");
      }

      await send(response, req, res);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        LEFT.has(String(error.code))
      ) {
        return;
      }

      console.error(error);

      if (res.headersSent) {
        res.destroy();
      } else {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Internal Server Error");
      }
    }
  };
}
