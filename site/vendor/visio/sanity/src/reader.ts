import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@sanity/client";
import type { QueryParams, SanityClient } from "@sanity/client";
import { getRequestEvent } from "@solidjs/web";
import { purgeCache, tagCache } from "@visio/router";

import { API_VERSION, studioPath } from "./constants.ts";
import {
  disableDraftMode,
  draftPerspective,
  enableDraftMode,
  setPerspective,
} from "./draft.ts";

/** The site's environment, as `src/env.ts` declares it. */
export interface SanityEnv {
  /** `undefined` defers the error to the first read, so a site without a project still boots. */
  SANITY_PROJECT_ID: string | undefined;
  SANITY_DATASET: string | undefined;
  SANITY_READ_TOKEN?: string | undefined;
  SANITY_REVALIDATE_SECRET?: string | undefined;
}

export interface Reader {
  read: (query: string, params?: QueryParams) => Promise<unknown>;
  /** The answer to a request under the API path; `action` is the segment after it. */
  route: (request: Request, action: string) => Response | Promise<Response>;
  /** For the tests. */
  client: () => SanityClient;
}

/** The one cache tag of every published read: a publish purges all of them. */
const CACHE_TAG = "sanity";

const NO_TOKEN =
  "Draft mode needs a read token. Set SANITY_READ_TOKEN in the server environment (src/env.ts), never as a PUBLIC_ variable.";

function notFound() {
  return new Response("Not found", { status: 404 });
}

const SIGNATURE = /^t=(?<timestamp>\d+)[, ]+v1=[^, ]+$/u;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

// timingSafeEqual throws on two lengths, so a short header would answer 500: both sides are hashed to one length first.
function sameValue(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export function createReader(env: SanityEnv): Reader {
  let client: SanityClient | undefined;

  function get(): SanityClient {
    if (client) {
      return client;
    }

    const missing = (["SANITY_PROJECT_ID", "SANITY_DATASET"] as const).filter(
      (key) => !env[key]
    );

    if (missing.length > 0) {
      throw new Error(
        `[@visio/sanity] ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
          "Set them in the site's server environment (src/env.ts declares them)."
      );
    }

    client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET,
      apiVersion: API_VERSION,
      token: env.SANITY_READ_TOKEN,
      // The CDN can lag a publish, and a build reading it bakes the old content.
      useCdn: false,
      perspective: "published",
      // A build fails instead of hanging.
      timeout: 20_000,
    });

    return client;
  }

  function withToken(): SanityClient {
    if (!env.SANITY_READ_TOKEN) {
      throw new Error(`[@visio/sanity] ${NO_TOKEN}`);
    }

    return get();
  }

  async function revalidate(request: Request): Promise<Response> {
    const secret = env.SANITY_REVALIDATE_SECRET;

    if (!secret) {
      return new Response("SANITY_REVALIDATE_SECRET is not set", {
        status: 500,
      });
    }

    const given = request.headers.get("sanity-webhook-signature")?.trim() ?? "";
    const timestamp = SIGNATURE.exec(given)?.groups?.timestamp;

    // The gate lets this path through: a request without a signature is turned away before its body is read.
    if (!timestamp) {
      return unauthorized();
    }

    const body = await request.text();

    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("base64url");

    if (!sameValue(given, `t=${timestamp},v1=${signature}`)) {
      return unauthorized();
    }

    await purgeCache([CACHE_TAG]);

    return Response.json({ revalidated: true });
  }

  return {
    async read(query, params = {}) {
      const perspective = draftPerspective(getRequestEvent()?.request);

      if (perspective) {
        return withToken().fetch<unknown>(query, params, {
          perspective,
          stega: { enabled: true, studioUrl: studioPath() },
        });
      }

      const result = await get().fetch<unknown>(query, params);
      await tagCache([CACHE_TAG]);

      return result;
    },
    route(request, action) {
      const method = request.method.toUpperCase();

      if (method === "GET" || method === "HEAD") {
        if (action === "enable") {
          return env.SANITY_READ_TOKEN
            ? enableDraftMode(request, get())
            : new Response(NO_TOKEN, { status: 500 });
        }

        if (action === "disable") {
          return disableDraftMode(request);
        }
      }

      if (method === "POST") {
        if (action === "perspective") {
          return setPerspective(request);
        }

        if (action === "revalidate") {
          return revalidate(request);
        }
      }

      return notFound();
    },
    client: get,
  };
}

let fromEnv: Reader | undefined;

/** The site's reader, from `process.env` on first use: the server environment the Solid plugin fills from `.env` in dev. */
export function siteReader(): Reader {
  fromEnv ??= createReader({
    SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
    SANITY_DATASET: process.env.SANITY_DATASET,
    SANITY_READ_TOKEN: process.env.SANITY_READ_TOKEN,
    SANITY_REVALIDATE_SECRET: process.env.SANITY_REVALIDATE_SECRET,
  });

  return fromEnv;
}
