import type { MetaArgs } from "@visio/router";
import type { TableEntry } from "@visio/router/internal/extend";

import type { LanguagePatterns, ParamValues } from "./table.ts";

/** What a route's `translations` returns: params by language. */
export type TranslatedParams = Readonly<
  Record<string, ParamValues | null | undefined>
>;

export type TranslationsOf = (
  args: MetaArgs
) => TranslatedParams | null | undefined;

/** The language of an entry the expansion made; undefined on the catch-all. */
export function entryLang(entry: TableEntry): string | undefined {
  return "lang" in entry && typeof entry.lang === "string"
    ? entry.lang
    : undefined;
}

/** The patterns of an entry the expansion made; undefined on the catch-all. */
export function entryPatterns(entry: TableEntry): LanguagePatterns | undefined {
  // SAFETY: only the expansion sets `patterns`, to a LanguagePatterns.
  return "patterns" in entry && typeof entry.patterns === "object"
    ? (entry.patterns as LanguagePatterns)
    : undefined;
}

/** The last argument of `page()` or `layout()`: the entry's other languages. */
export function translatedPaths(
  entry: TableEntry
): Readonly<Record<string, string>> {
  const { options } = entry;

  // SAFETY: the entry options of this package are its translated paths,
  // which EntryOptionsExtension types for the table's callers.
  return typeof options === "object" && options !== null
    ? (options as Readonly<Record<string, string>>)
    : {};
}

/** The `translations` of the page module's route, when it declares them. */
export function routeTranslations(
  entry: TableEntry
): TranslationsOf | undefined {
  const route = entry.route ?? {};

  // SAFETY: RouteOptionsExtension types `translations` for defineRoute(),
  // as a function of the meta args to params by language.
  return "translations" in route && typeof route.translations === "function"
    ? (route.translations as TranslationsOf)
    : undefined;
}

/** Whether a param's value passes its match filter. */
export type ParamFilter = (value: string) => boolean;

/** A match filter as Solid Router reads it: a list of values, a RegExp, or a function. */
function asFilter(filter: unknown): ParamFilter | undefined {
  if (Array.isArray(filter)) {
    return (value) => filter.includes(value);
  }

  if (filter instanceof RegExp) {
    return (value) => filter.test(value);
  }

  if (typeof filter === "function") {
    return (value) => Boolean(filter(value));
  }

  return undefined;
}

/** An entry's match filters, by param name. */
export function paramFilters(entry: TableEntry): Map<string, ParamFilter> {
  const out = new Map<string, ParamFilter>();
  const { matchFilters } = entry;

  if (typeof matchFilters !== "object" || matchFilters === null) {
    return out;
  }

  for (const [name, filter] of Object.entries(matchFilters)) {
    const test = asFilter(filter);

    if (test) {
      out.set(name, test);
    }
  }

  return out;
}
