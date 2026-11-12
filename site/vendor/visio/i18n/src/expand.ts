import { relativeTo } from "@visio/router/internal/extend";
import type { TableEntry } from "@visio/router/internal/extend";

import { paramFilters, translatedPaths } from "./entry.ts";
import type { ParamFilter } from "./entry.ts";
import type { LanguagePatterns, LanguageRoute } from "./table.ts";

/** A table entry once it is in a language. */
export interface LangEntry extends TableEntry {
  /** The entry's language; absent on the catch-all, which takes the URL's. */
  readonly lang?: string;
  /** The route's full pattern in each language it exists in; absent on the catch-all. */
  readonly patterns?: LanguagePatterns;
  readonly children?: readonly LangEntry[];
}

/** The tree in every language, and each page route's patterns. */
export interface Expanded {
  pages: LangEntry[];
  routes: LanguageRoute[];
}

interface Parent {
  /** The layout's full pattern in this language. */
  readonly full: string;
  readonly patterns: LanguagePatterns;
  /** The match filters of the layouts above, by param name. */
  readonly filters: ReadonlyMap<string, ParamFilter>;
}

function ordered(
  order: readonly string[],
  patterns: Readonly<Partial<Record<string, string>>>
): LanguagePatterns {
  const out: Record<string, string> = {};

  for (const tag of order) {
    const pattern = patterns[tag];

    if (pattern !== undefined) {
      out[tag] = pattern;
    }
  }

  return out;
}

function accepts(
  filters: ReadonlyMap<string, ParamFilter>
): LanguageRoute["accepts"] {
  if (filters.size === 0) {
    return undefined;
  }

  return (params) =>
    [...filters].every(([name, test]) => {
      const value = params[name];

      return value === undefined || test(value);
    });
}

/**
 * A default-language entry at the top whose first segment is a param, with
 * a filter that keeps the other languages' prefixes out of it: `/:slug`
 * would match `/it`, so the page would answer in the wrong language.
 */
function withoutPrefixes(
  entry: LangEntry,
  own: ReadonlyMap<string, ParamFilter>,
  others: readonly string[]
): LangEntry {
  const [, segment = ""] = entry.path.split("/", 2);

  if (!/^[:*]/v.test(segment)) {
    return entry;
  }

  const name = segment.slice(1).replace(/\?$/v, "");
  const test = own.get(name);

  return {
    ...entry,
    matchFilters: {
      ...Object.fromEntries(own),
      [name]: (value: string) =>
        !others.includes(value.split("/", 1)[0] ?? "") &&
        (test === undefined || test(value)),
    },
  };
}

function level(
  entries: readonly TableEntry[],
  lang: string,
  order: readonly string[],
  parent: Parent | undefined,
  routes: LanguageRoute[] | undefined
): LangEntry[] {
  const [first = "", ...others] = order;
  const out: LangEntry[] = [];

  for (const entry of entries) {
    if (entry.path === "*404") {
      if (lang === first) {
        out.push(entry);
      }

      continue;
    }

    // An index has no pattern of its own: it is at its layout's.
    const patterns =
      entry.pattern === undefined
        ? (parent?.patterns ?? {})
        : ordered(order, { ...translatedPaths(entry), [first]: entry.pattern });

    const full = patterns[lang];

    if (full === undefined) {
      continue;
    }

    const own = paramFilters(entry);
    const filters = new Map([...(parent?.filters ?? []), ...own]);

    let def: LangEntry = {
      ...entry,
      path: parent ? relativeTo(parent.full, full) : full,
      lang,
      patterns,
    };

    // Under `layout("/")` the entry's own path still starts at the root.
    if ((!parent || parent.full === "/") && lang === first) {
      def = withoutPrefixes(def, own, others);
    }

    if (entry.children) {
      out.push({
        ...def,
        children: level(
          entry.children,
          lang,
          order,
          { full, patterns, filters },
          routes
        ),
      });
    } else {
      routes?.push({ patterns, accepts: accepts(filters) });
      out.push(def);
    }
  }

  return out;
}

/** The page tree once per language, the default first (DESIGN.md). */
export function expandPages(
  entries: readonly TableEntry[],
  order: readonly string[]
): Expanded {
  const routes: LanguageRoute[] = [];

  const pages = order.flatMap((lang, i) =>
    level(entries, lang, order, undefined, i === 0 ? routes : undefined)
  );

  return { pages, routes };
}
