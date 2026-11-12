import type { RouterLike } from "./chain.ts";
import type {
  ApiDef,
  ApiHandler,
  ApiModule,
  HttpMethod,
  Middleware,
} from "./index.ts";

const HTTP_METHODS: readonly HttpMethod[] = [
  "HEAD",
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
];

function isHttpMethod(method: string): method is HttpMethod {
  return HTTP_METHODS.some((m) => m === method);
}

/** A path segment decoded, or undefined when its escapes are malformed (`%E0`). */
function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * The patterns an optional segment stands for, the longer first, as Solid
 * Router reads them: `/a/:b?/c` is `/a/:b/c` and `/a/c`.
 */
function expandOptionals(segments: string[]): string[][] {
  let out: string[][] = [[]];

  for (const segment of segments) {
    if (segment.startsWith(":") && segment.endsWith("?")) {
      const required = segment.slice(0, -1);
      out = out.flatMap((p) => [[...p, required], p]);
    } else {
      out = out.map((p) => [...p, segment]);
    }
  }

  return out;
}

/**
 * Matches a pathname against a pattern with `:param`, optional `:param?`
 * and `*rest` segments. Params come decoded, the rest segment by segment;
 * a malformed escape in one is no match.
 */
export function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const have = pathname.split("/").filter(Boolean);

  for (const want of expandOptionals(pattern.split("/").filter(Boolean))) {
    const params = matchSegments(want, have);

    if (params) {
      return params;
    }
  }

  return null;
}

function matchSegments(
  want: string[],
  have: string[]
): Record<string, string> | null {
  const params: Record<string, string> = {};

  for (const [i, segment] of want.entries()) {
    if (segment.startsWith("*")) {
      const rest = have.slice(i).map(decode);

      if (rest.includes(undefined)) {
        return null;
      }

      params[segment.slice(1) || "rest"] = rest.join("/");

      return params;
    }

    const part = have[i];

    if (part === undefined) {
      return null;
    }

    if (segment.startsWith(":")) {
      const value = decode(part);

      if (value === undefined) {
        return null;
      }

      params[segment.slice(1)] = value;
    } else if (segment !== part) {
      return null;
    }
  }

  return have.length === want.length ? params : null;
}

function toResponse(
  result: Awaited<ReturnType<ApiHandler>>
): Response | undefined {
  if (result === undefined || result === null) {
    return undefined;
  }

  if (result instanceof Response) {
    return result;
  }

  if (typeof result === "string") {
    return new Response(result, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return Response.json(result);
}

/**
 * Fetch-style middleware answering `api()` routes from their module's
 * uppercase method exports. Unmatched paths and methods fall through to
 * `next()`, `HEAD` falls back to `GET`, and a handler may return a
 * `Response`, a string, JSON data, or nothing to let the page render.
 */
export function apiMiddleware(routes: readonly ApiDef[]): Middleware {
  return async ({ request }, next) => {
    const { pathname } = new URL(request.url);

    // Routes are tried in table order and the first answer wins, so the
    // awaits are sequential on purpose.
    /* oxlint-disable no-await-in-loop */
    for (const route of routes) {
      const params = matchPath(route.path, pathname);

      if (!params || !route.load) {
        continue;
      }

      const mod: ApiModule = await route.load();
      const method = request.method.toUpperCase();

      if (!isHttpMethod(method)) {
        continue;
      }

      const handler: ApiHandler | undefined =
        mod[method] ?? (method === "HEAD" ? mod.GET : undefined);

      if (!handler) {
        continue;
      }

      const response = toResponse(await handler({ request, params }));

      if (response) {
        return response;
      }
    }

    /* oxlint-enable no-await-in-loop */
    return next();
  };
}

/** Whether the page tree has a page at `pathname`: a match that is not the catch-all. */
export function isPage(router: RouterLike, pathname: string): boolean {
  const last = router.match(pathname).at(-1);

  return last !== undefined && last.path !== "*404";
}
