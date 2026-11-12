import { getRequestEvent, isServer } from "@solidjs/web";

/** A route's full pattern in each language it exists in, the default first. */
export type LanguagePatterns = Readonly<Record<string, string>>;

/** A param value as a pattern takes it. */
export type ParamValue = string | number | null | undefined;

/** A page's params, by name. */
export type ParamValues = Readonly<Record<string, ParamValue>>;

/** A page route: its pattern in each language, and its match filters. */
export interface LanguageRoute {
  readonly patterns: LanguagePatterns;
  /** Whether the params pass the route's match filters; absent without filters. */
  readonly accepts?:
    | ((params: Readonly<Record<string, string>>) => boolean)
    | undefined;
}

/** The site's languages, and its page routes once the router has read them. */
export interface LanguageTable {
  /** Language tag to `og:locale`, in the order the site declares them. */
  readonly locales: Readonly<Record<string, string>>;
  readonly default: string;
  /** The tags, the default first. */
  readonly order: readonly string[];
  /** Every page route, the most specific default pattern first. */
  routes: readonly LanguageRoute[];
}

// The site's table, for lang() in the document, which has no router: set
// once when src/routes.ts loads, the same for every request.
let site: LanguageTable | undefined;

export function createTable(
  locales: Readonly<Record<string, string>>,
  first: string
): LanguageTable {
  if (!Object.hasOwn(locales, first)) {
    throw new Error(
      `[@visio/i18n] [LANGUAGE_DEFAULT_UNKNOWN] defineLanguages() has default ${JSON.stringify(first)}, which is not one of ${Object.keys(locales).join(", ")}: the default is the language at the root, without a prefix.`
    );
  }

  const table: LanguageTable = {
    locales,
    default: first,
    order: [first, ...Object.keys(locales).filter((tag) => tag !== first)],
    routes: [],
  };

  site = table;

  return table;
}

/** The table of `defineLanguages()`. */
export function siteTable(): LanguageTable {
  if (!site) {
    throw new Error(
      "[@visio/i18n] [LANGUAGES_UNDEFINED] lang() needs the site's languages, and no defineLanguages() has run. Declare them in src/routes.ts and pass them in extensions of defineRoutes() (.claude/skills/i18n/SKILL.md)."
    );
  }

  return site;
}

function specificity(pattern: string): number {
  return pattern
    .split("/")
    .filter((segment) => segment && !/^[:*]/v.test(segment)).length;
}

/** The routes, the most specific default pattern first, for `translatePath()`. */
export function setRoutes(
  table: LanguageTable,
  routes: readonly LanguageRoute[]
): void {
  table.routes = routes.toSorted(
    (a, b) =>
      specificity(b.patterns[table.default] ?? "") -
      specificity(a.patterns[table.default] ?? "")
  );
}

/**
 * The language a path is in: its first segment when that is a language
 * other than the default, else the default.
 */
export function langOf(table: LanguageTable, pathname: string): string {
  const [, first = ""] = pathname.split("/", 2);

  return first !== table.default && Object.hasOwn(table.locales, first)
    ? first
    : table.default;
}

/**
 * The language of the page the request is for, for `<html lang>` in the
 * document: the request's path on the server, the address in the browser.
 */
export function lang(): string {
  const table = siteTable();

  if (isServer) {
    const url = getRequestEvent()?.request.url;

    return langOf(table, url ? new URL(url).pathname : "/");
  }

  return langOf(table, window.location.pathname);
}

// The scripts Unicode writes right to left (UAX #9), by their ISO 15924 code.
const RTL_SCRIPTS = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

/** The direction of a language's usual script. `maximize()` is in every browser; `getTextInfo()` is not. */
export function dirOf(tag: string): "rtl" | "ltr" {
  const { script = "" } = new Intl.Locale(tag).maximize();

  return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
}

/** The text direction of the page the request is for, for `<html dir>` beside `lang()`. */
export function dir(): "rtl" | "ltr" {
  return dirOf(lang());
}

export function encodeParam(value: string | number): string {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

function isEmpty(value: ParamValue): value is null | undefined | "" {
  return value === undefined || value === null || value === "";
}

/** A pattern with its params filled in; undefined when a required one is missing. */
export function fillPattern(
  pattern: string,
  params: ParamValues
): string | undefined {
  const out: string[] = [];

  for (const segment of pattern.split("/").filter(Boolean)) {
    if (segment.startsWith("*")) {
      const value = params[segment.slice(1)];

      if (!isEmpty(value)) {
        out.push(encodeParam(value));
      }

      continue;
    }

    if (!segment.startsWith(":")) {
      out.push(segment);
      continue;
    }

    const optional = segment.endsWith("?");
    const value = params[segment.slice(1, optional ? -1 : undefined)];

    if (isEmpty(value)) {
      if (optional) {
        continue;
      }

      return undefined;
    }

    out.push(encodeParam(value));
  }

  return `/${out.join("/")}`;
}

/** The params of `pathname` under `pattern`, decoded; undefined when it does not match. */
export function matchPattern(
  pattern: string,
  pathname: string
): Record<string, string> | undefined {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let at = 0;

  for (const segment of want) {
    if (segment.startsWith("*")) {
      params[segment.slice(1)] = have
        .slice(at)
        .map(decodeURIComponent)
        .join("/");

      return params;
    }

    const part = have[at];

    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");

      if (part === undefined) {
        if (optional) {
          continue;
        }

        return undefined;
      }

      params[segment.slice(1, optional ? -1 : undefined)] =
        decodeURIComponent(part);
    } else if (part !== segment) {
      return undefined;
    }

    at += 1;
  }

  return at === have.length ? params : undefined;
}

/**
 * A default-language path in `tag`: the same route's pattern in that
 * language with the same params. The search and hash stay as they are.
 */
export function translatePath(
  table: LanguageTable,
  path: string,
  tag: string
): string {
  if (tag === table.default) {
    return path;
  }

  const cut = path.search(/[?#]/v);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  const rest = cut === -1 ? "" : path.slice(cut);

  for (const { patterns, accepts } of table.routes) {
    const from = patterns[table.default];

    const params =
      from === undefined ? undefined : matchPattern(from, pathname);

    if (!params || (accepts && !accepts(params))) {
      continue;
    }

    const to = patterns[tag];
    const filled = to === undefined ? undefined : fillPattern(to, params);

    if (filled === undefined) {
      throw new Error(
        `[@visio/i18n] [ROUTE_NOT_IN_LANGUAGE] ${pathname} has no page in ${JSON.stringify(tag)}. Add its ${tag} path to the route's entry in src/routes.ts, or link to another page.`
      );
    }

    return filled + rest;
  }

  throw new Error(
    `[@visio/i18n] [PATH_NOT_ROUTED] ${pathname} matches no route of src/routes.ts, so it has no ${JSON.stringify(tag)} path. Build it with paths(lang).`
  );
}
