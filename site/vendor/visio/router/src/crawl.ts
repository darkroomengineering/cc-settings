import type { RequestEvent } from "@solidjs/web";
import { HINT_HEADER } from "prerender-crawler/announce";

import type { LanguageParams, LanguagePath, TableEntry } from "./extend.ts";

/** A page's params as `announce` gives them; an optional one may be absent. */
export type AnnouncedParams = Readonly<Record<string, string | undefined>>;

/** An entry of `announce`: the params, and the head facts beside them (`AnnounceFacts`). */
interface AnnouncedEntry {
  readonly modified?: string | undefined;
  readonly noindex?: boolean | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly translations?: LanguageParams | null | undefined;
  readonly [param: string]:
    | string
    | boolean
    | LanguageParams
    | null
    | undefined;
}

/** The keys of `AnnounceFacts`, and of `AnnounceFactsExtension` (`@visio/i18n`'s). No param may have one of these names. */
const FACT_KEYS = new Set([
  "modified",
  "noindex",
  "title",
  "description",
  "translations",
]);

/** An announced page with the head facts its entry gave, for the crawl's check and the live lists. */
export interface AnnouncedFacts {
  path: string;
  /** The route's full pattern. */
  pattern: string;
  modified?: string | undefined;
  noindex?: boolean | undefined;
  title?: string | undefined;
  description?: string | undefined;
  /** From `translations`, through the extension that has languages. */
  alternates?: readonly LanguagePath[] | undefined;
}

/**
 * What the crawl's request for `/` gets besides the hint: every announced
 * page with its facts, and the patterns that announce. URI-encoded JSON,
 * since a header value takes no character above U+00FF.
 */
export const ANNOUNCED_HEADER = "x-visio-announced";

export interface AnnouncedList {
  patterns: string[];
  pages: AnnouncedFacts[];
}

/** The routes of `defineRoutes()`, as the crawl's middleware reads them. */
export interface CrawledRoutes {
  readonly pages: readonly TableEntry[];
}

/** What a route's `announce` gives the crawl: its pattern and its params. */
export interface Announcer {
  /** The full pattern, a language's own with an extension such as `@visio/i18n`. */
  readonly pattern: string;
  readonly params: () => Promise<readonly AnnouncedEntry[]>;
  /** The page's language versions from its entry, with an extension that has languages. */
  readonly alternates?:
    | ((translations: LanguageParams) => readonly LanguagePath[])
    | undefined;
}

const announcers = new WeakMap<readonly TableEntry[], readonly Announcer[]>();

/** Called by `defineRoutes()`, which knows the routes and the extensions' args. */
export function registerAnnouncers(
  routes: CrawledRoutes,
  list: readonly Announcer[]
): void {
  announcers.set(routes.pages, list);
}

const SEGMENT = /^(?<kind>[:*])(?<name>[^?]+)(?<optional>\?)?$/v;

/** `/legal/:slug` with `{ slug: "terms" }` is `/legal/terms`. Exported for tests. */
export function fillPattern(pattern: string, params: AnnouncedParams): string {
  const parts = pattern.split("/").flatMap((segment) => {
    const match = SEGMENT.exec(segment)?.groups;

    if (!match?.name) {
      return [segment];
    }

    const value = params[match.name];

    if (value === undefined || value === "") {
      if (match.optional || match.kind === "*") {
        return [];
      }

      throw new Error(
        `[@visio/router] [ANNOUNCE_PARAM_MISSING] announce() of ${pattern} gave ${JSON.stringify(params)}, with no \`${match.name}\`.`
      );
    }

    return match.kind === "*"
      ? value.split("/").map((part) => encodeURIComponent(part))
      : [encodeURIComponent(value)];
  });

  return parts.join("/") || "/";
}

function paramNames(pattern: string): string[] {
  return pattern
    .split("/")
    .flatMap((segment) => SEGMENT.exec(segment)?.groups?.name ?? []);
}

/** One entry of `announce` as a page: its path, from the params, and its facts. */
function factsOf(announcer: Announcer, entry: AnnouncedEntry): AnnouncedFacts {
  // Every key but the facts, so ANNOUNCE_PARAM_MISSING shows what the entry gave.
  const params = Object.fromEntries(
    Object.entries(entry)
      .filter(([key, value]) => !FACT_KEYS.has(key) && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );

  const facts: AnnouncedFacts = {
    path: fillPattern(announcer.pattern, params),
    pattern: announcer.pattern,
  };

  const { modified, noindex, title, description, translations } = entry;
  Object.assign(facts, { modified, noindex, title, description });

  if (translations && announcer.alternates) {
    facts.alternates = announcer.alternates(translations);
  }

  return facts;
}

/** Every page the routes' `announce` give, with its facts. */
export async function announcedPages(
  list: readonly Announcer[]
): Promise<AnnouncedFacts[]> {
  const pages = await Promise.all(
    list.map(async (announcer) => {
      const { pattern } = announcer;
      const reserved = paramNames(pattern).find((n) => FACT_KEYS.has(n));

      if (reserved) {
        throw new Error(
          `[@visio/router] [ANNOUNCE_PARAM_RESERVED] ${pattern} has a param named \`${reserved}\`, which is a head fact of announce(). Rename the param in src/routes.ts and in the page's defineRoute().`
        );
      }

      let all: readonly AnnouncedEntry[];

      try {
        all = await announcer.params();
      } catch (error) {
        throw new Error(
          `[@visio/router] [ANNOUNCE_FAILED] announce() of ${pattern} threw, so the crawl cannot list its pages.`,
          { cause: error }
        );
      }

      return all.map((entry) => factsOf(announcer, entry));
    })
  );

  return pages.flat();
}

/** The announced pages of `routes`, or none before `defineRoutes()` registered them. */
export function announcersOf(routes: CrawledRoutes): readonly Announcer[] {
  return announcers.get(routes.pages) ?? [];
}

/**
 * First in the chain `visio()` builds (visio's DESIGN.md, In-order pages).
 * On the crawl's request for `/`, where every crawl starts, it also adds
 * the paths the routes' `announce` give to the crawl's hint header, once a
 * crawl and never for a visitor.
 */
export function crawlMiddleware(
  routes: CrawledRoutes
): (
  event: RequestEvent,
  next: () => Promise<Response>
) => Response | Promise<Response> {
  return async (event, next) => {
    if (!event.request.headers.has(HINT_HEADER)) {
      return next();
    }

    // Solid's server reads `renderMode` off the event; its type does not declare it.
    Object.assign(event, { renderMode: "async" });
    const response = await next();
    const list = announcersOf(routes);

    if (list.length === 0 || new URL(event.request.url).pathname !== "/") {
      return response;
    }

    const pages = await announcedPages(list);

    if (pages.length > 0) {
      const had = response.headers.get(HINT_HEADER);
      response.headers.set(
        HINT_HEADER,
        [...(had ? [had] : []), ...pages.map((p) => p.path)].join(",")
      );
    }

    const announcedList: AnnouncedList = {
      patterns: list.map((a) => a.pattern),
      pages,
    };

    response.headers.set(
      ANNOUNCED_HEADER,
      encodeURIComponent(JSON.stringify(announcedList))
    );

    return response;
  };
}
