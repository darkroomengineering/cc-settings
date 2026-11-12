import { isDev } from "@solidjs/web";
import type { HeadTag } from "@solidjs/web";
import { absoluteUrl } from "@visio/router";
import type { MetaArgs } from "@visio/router";
import type {
  HeadAddition,
  LanguageParams,
  LanguagePath,
  TableEntry,
} from "@visio/router/internal/extend";

import { entryPatterns, routeTranslations } from "./entry.ts";
import type { TranslatedParams } from "./entry.ts";
import { fillPattern } from "./table.ts";
import type { LanguageTable } from "./table.ts";

/** The current page's path in each language it exists in. */
export type PagePaths = Readonly<Record<string, string>>;

/**
 * The page's own language and its path in each language it exists in, or
 * `null` when it does not exist in its own.
 */
export interface PageLanguages {
  lang: string;
  paths: PagePaths | null;
}

const warned = new Set<string>();

// Once per route and language: another route can lack the same language.
function warnPathMissing(
  language: string,
  pathname: string,
  route: string
): void {
  const key = `${route} ${language}`;

  if (!isDev || warned.has(key)) {
    return;
  }

  warned.add(key);
  console.warn(
    `[@visio/i18n] [TRANSLATION_PATH_MISSING] translations() of ${pathname} names ${JSON.stringify(language)}, but its route has no ${language} path in src/routes.ts, so no ${language} page is linked. Add the path to the route's entry.`
  );
}

/**
 * Where the page exists: every language of its route without
 * `translations`, else the ones that names, each with its own params.
 */
export function pageLanguages(
  table: LanguageTable,
  entry: TableEntry,
  args: MetaArgs
): PageLanguages {
  const patterns = entryPatterns(entry);

  if (!patterns) {
    return { lang: args.lang, paths: {} };
  }

  const translations = routeTranslations(entry);

  const given: TranslatedParams | null | undefined = translations
    ? translations(args)
    : Object.fromEntries(Object.keys(patterns).map((l) => [l, args.params]));

  const paths = languagePaths(table, patterns, given, (language) =>
    warnPathMissing(
      language,
      args.location.pathname,
      entry.pattern ?? args.location.pathname
    )
  );

  return {
    lang: args.lang,
    paths: Object.hasOwn(paths, args.lang) ? paths : null,
  };
}

/** The path in each language that `given` names params for and the route has a pattern in. */
function languagePaths(
  table: LanguageTable,
  patterns: NonNullable<ReturnType<typeof entryPatterns>>,
  given: TranslatedParams | null | undefined,
  missing?: (language: string) => void
) {
  const paths: Record<string, string> = {};

  for (const language of table.order) {
    const params = given?.[language];
    const pattern = patterns[language];

    if (params && pattern === undefined) {
      missing?.(language);
    }

    const path = params && pattern && fillPattern(pattern, params);

    if (path) {
      paths[language] = path;
    }
  }

  return paths;
}

/** Each path with its `hreflang`, and `x-default` to the default language's, for two languages or more. */
function hreflangPaths(table: LanguageTable, paths: PagePaths): LanguagePath[] {
  if (Object.keys(paths).length < 2) {
    return [];
  }

  const links = Object.entries(paths).map(([hreflang, path]) => ({
    hreflang,
    path,
  }));

  const fallback = paths[table.default];

  return fallback === undefined
    ? links
    : [...links, { hreflang: "x-default", path: fallback }];
}

/** The language versions of an announced page, from the `translations` its entry gives. */
export function announcedAlternates(
  table: LanguageTable,
  entry: TableEntry,
  translations: LanguageParams
): LanguagePath[] {
  const patterns = entryPatterns(entry);

  return patterns
    ? hreflangPaths(table, languagePaths(table, patterns, translations))
    : [];
}

/**
 * The alternate links and locales of a page in more than one language, and
 * `x-default` to its default-language page when it has one.
 */
function alternateTags(
  table: LanguageTable,
  own: string,
  paths: PagePaths
): HeadTag[] {
  if (Object.keys(paths).length < 2) {
    return [];
  }

  const tags: HeadTag[] = [];
  let i = 0;

  for (const language of Object.keys(paths)) {
    const locale = table.locales[language];

    if (language !== own && locale) {
      tags.push({
        tag: "meta",
        props: { property: "og:locale:alternate", content: locale },
        key: `og:locale:alternate:${i}`,
      });
      i += 1;
    }
  }

  for (const { hreflang, path } of hreflangPaths(table, paths)) {
    tags.push({
      tag: "link",
      props: { rel: "alternate", hreflang, href: absoluteUrl(path) },
      key: `hreflang:${hreflang}`,
    });
  }

  return tags;
}

/** The page's locale, its alternates, and a 404 when it is not in its own language. */
export function languageHead(
  table: LanguageTable,
  entry: TableEntry,
  args: MetaArgs
): HeadAddition {
  const { lang, paths } = pageLanguages(table, entry, args);
  const locale = table.locales[lang];
  const meta = locale ? { locale } : {};

  return paths === null
    ? { meta, notFound: true }
    : {
        meta,
        tags: alternateTags(table, lang, paths),
        announce: Object.entries(paths)
          .filter(([language]) => language !== lang)
          .map(([, path]) => path),
      };
}
