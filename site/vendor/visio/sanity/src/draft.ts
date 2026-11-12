import type { ClientPerspective } from "@sanity/client";
import { validatePreviewUrl } from "@sanity/preview-url-secret";
import type { SanityClientLike } from "@sanity/preview-url-secret";

import { BYPASS_COOKIE, PERSPECTIVE_COOKIE } from "./constants.ts";

/**
 * The deployment's bypass token. The build sets it in the Vercel function and
 * in the Cloudflare Worker's vars; anywhere else (the dev server, `vite
 * preview`) the process makes one up, kept in the environment so a reloaded
 * module still accepts the cookie.
 */
export function bypassToken(): string {
  return (process.env.VISIO_BYPASS_TOKEN ??= crypto.randomUUID());
}

/** The value of cookie `name` in the request, the first one when it repeats. */
function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");

    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }

  return undefined;
}

/**
 * The perspective the Studio asked for: `drafts` (the default), `published`,
 * or a stack of release ids over the drafts. Anything else reads as `drafts`.
 */
export function parsePerspective(value: string | undefined): ClientPerspective {
  let raw = "";

  try {
    raw = value ? decodeURIComponent(value) : "";
  } catch {
    // Not percent-encoding: read as `drafts`, like any other unknown value.
  }

  if (raw === "published" || raw === "drafts") {
    return raw;
  }

  const stack = raw
    .split(",")
    .filter((id) => /^[\w.\-]+$/v.test(id) && id !== "raw");

  return stack.length > 0 ? stack : "drafts";
}

/** The perspective of a draft request, or null for everyone else. */
export function draftPerspective(
  request: Request | undefined
): ClientPerspective | null {
  if (!request || readCookie(request, BYPASS_COOKIE) !== bypassToken()) {
    return null;
  }

  return parsePerspective(readCookie(request, PERSPECTIVE_COOKIE));
}

/** Seconds. */
const SESSION = 8 * 60 * 60;

/**
 * Sent inside the Studio's iframe: `SameSite=None; Secure` (localhost counts
 * as secure), and `Partitioned` on every route, so each route writes the
 * partition the enable route wrote. Safari keeps only partitioned (CHIPS)
 * cookies in a third-party frame. The perspective cookie is script-readable
 * so the page can load the overlay; it unlocks nothing without the bypass
 * cookie.
 */
function attributes(options: { script?: boolean; maxAge?: number } = {}) {
  return `; Path=/${options.script ? "" : "; HttpOnly"}; Secure; SameSite=None; Partitioned${
    options.maxAge === undefined ? "" : `; Max-Age=${options.maxAge}`
  }`;
}

/**
 * A path on this site, or `/`: a redirect never leaves the origin. Resolved as
 * the browser would, which reads `/\host` and `/<tab>/host` as `//host`.
 */
function samePath(request: Request, path: string | null | undefined): string {
  const { origin } = new URL(request.url);
  const url = path ? URL.parse(path, origin) : null;

  if (url?.origin !== origin) {
    return "/";
  }

  // `/.//host` resolves to the path `//host`, which is another host again.
  return `/${url.pathname.replace(/^\/+/v, "")}${url.search}${url.hash}`;
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });

  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, { status: 307, headers });
}

/**
 * The Presentation tool's enable route: checks the Studio's preview secret
 * against the dataset with the read token, then sets the draft cookies.
 */
export async function enableDraftMode(
  request: Request,
  client: SanityClientLike
) {
  const { isValid, redirectTo, studioPreviewPerspective } =
    await validatePreviewUrl(client, request.url);

  if (!isValid) {
    return new Response("Invalid preview secret", { status: 401 });
  }

  return redirect(samePath(request, redirectTo), [
    `${BYPASS_COOKIE}=${bypassToken()}${attributes({ maxAge: SESSION })}`,
    `${PERSPECTIVE_COOKIE}=${encodeURIComponent(studioPreviewPerspective || "drafts")}${attributes({ script: true, maxAge: SESSION })}`,
  ]);
}

/** The Studio switched perspective (a release, or published); the next reads follow it. */
export async function setPerspective(request: Request): Promise<Response> {
  // After a deploy the bypass token is new but the cookies stay: the expired
  // perspective cookie keeps the next page from loading the overlay.
  if (!draftPerspective(request)) {
    return new Response("Not in draft mode", {
      status: 403,
      headers: {
        "set-cookie": `${PERSPECTIVE_COOKIE}=${attributes({ script: true, maxAge: 0 })}`,
      },
    });
  }

  // SAFETY: only an object has a property; the field is checked below.
  const body = (await request.json().catch(() => null)) as {
    perspective?: unknown;
  } | null;

  const value = body?.perspective;
  let raw: string | undefined;

  if (Array.isArray(value)) {
    raw = value.join(",");
  } else if (typeof value === "string") {
    raw = value;
  }

  const perspective = parsePerspective(raw);

  const encoded = encodeURIComponent(
    Array.isArray(perspective) ? perspective.join(",") : perspective
  );

  // Both again, so the session ends 8 hours after the editor's last switch
  // and neither cookie outlives the other.
  const headers = new Headers();
  headers.append(
    "set-cookie",
    `${BYPASS_COOKIE}=${bypassToken()}${attributes({ maxAge: SESSION })}`
  );
  headers.append(
    "set-cookie",
    `${PERSPECTIVE_COOKIE}=${encoded}${attributes({ script: true, maxAge: SESSION })}`
  );

  return new Response(null, { status: 204, headers });
}

/**
 * Ends draft mode and goes to `?redirect=` or `/`. A browser's speculative
 * prefetch of the link is turned away, or merely hovering an exit link would
 * end the session.
 */
export function disableDraftMode(request: Request): Response {
  const purpose =
    request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";

  if (purpose.includes("prefetch")) {
    return new Response(null, { status: 204 });
  }

  return redirect(
    samePath(request, new URL(request.url).searchParams.get("redirect")),
    [
      `${BYPASS_COOKIE}=${attributes({ maxAge: 0 })}`,
      `${PERSPECTIVE_COOKIE}=${attributes({ script: true, maxAge: 0 })}`,
    ]
  );
}
