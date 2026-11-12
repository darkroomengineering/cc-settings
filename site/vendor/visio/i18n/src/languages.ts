import type { Location, RouteParams, RouteSectionProps } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { useLocation } from "@visio/router";
import { withArgs, wrapComponent } from "@visio/router/internal/extend";
import type {
  RouteArgsExtension,
  RouterExtension,
  TableEntry,
} from "@visio/router/internal/extend";
import { createComponent, createEffect } from "solid-js";
import type { Accessor } from "solid-js";

import { PageLang, Translated } from "./context.ts";
import { entryLang } from "./entry.ts";
import { expandPages } from "./expand.ts";
import { announcedAlternates, languageHead, pageLanguages } from "./head.ts";
import type { PagePaths } from "./head.ts";
import { langPaths } from "./paths.ts";
import { createTable, dirOf, langOf, setRoutes } from "./table.ts";
import type { LanguageTable } from "./table.ts";

/**
 * What a site registers for its types, in `src/routes.ts`:
 * `declare module '@visio/i18n' { interface Register { languages: typeof languages } }`.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- the site's declaration fills it.
export interface Register {}

/** Language tag to `og:locale`, `{ de: 'de_DE', it: 'it_IT' }`. */
export type Locales = Readonly<Record<string, string>>;

export interface LanguagesOptions<G extends Locales, D extends string> {
  /** Language tag (the `hreflang`, the `<html lang>`, the URL prefix) to `og:locale`. */
  locales: G;
  /** The language at the root, without a prefix. */
  default: D;
}

/** The site's languages, as the router's `extensions` take them. */
export interface Languages<
  G extends Locales = Locales,
  D extends string = string,
> extends RouterExtension<PagePaths> {
  readonly locales: G;
  readonly default: D;
}

interface Unregistered {
  lang: string;
  default: string;
}

type Registered = Register extends { languages: infer L }
  ? L extends Languages<infer G, infer D>
    ? { lang: Extract<keyof G, string>; default: D }
    : Unregistered
  : Unregistered;

/** One of the site's languages; `string` until the site registers them. */
export type Lang = Registered["lang"];

/** The site's default language. */
export type DefaultLang = Registered["default"];

/** A route's full path in each language but the default, `{ it: '/it/progetti/:slug' }`. */
export type Translations = Readonly<
  Partial<Record<Exclude<Lang, DefaultLang>, string>>
>;

/** A page's params in each language it exists in; a language left out has no page. */
export type TranslationParams<P extends string = string> = Partial<
  Record<Lang, RouteParams<P>>
>;

/** Each entry's component inside its own language, for `useLang()` in what the page renders. */
function withPageLang(pages: readonly TableEntry[]): TableEntry[] {
  return pages.map((entry) => ({
    ...entry,
    component: wrapComponent(entry.component, (props) =>
      createComponent(PageLang, {
        // SAFETY: withArgs() wraps this component and gives its props `lang`.
        value: () => (props as RouteSectionProps & RouteArgsExtension).lang,
        get children() {
          return createComponent(entry.component, props);
        },
      })
    ),
    children: entry.children && withPageLang(entry.children),
  }));
}

/** The router's children, with the page's paths below and `<html lang>` and `dir` kept current. */
function languageRoot(
  table: LanguageTable,
  state: Accessor<PagePaths | undefined>,
  children: () => JSX.Element
): JSX.Element {
  const location = useLocation();
  // The server's apply never runs.
  createEffect(
    () => langOf(table, location.pathname),
    (current) => {
      document.documentElement.lang = current;
      document.documentElement.dir = dirOf(current);
    }
  );

  return createComponent(Translated, {
    value: () => state() ?? {},
    get children() {
      return children();
    },
  });
}

/**
 * Declares the site's languages, for `extensions` of `defineRoutes()`:
 *
 * ```ts
 * export const languages = defineLanguages({
 *   locales: { de: 'de_DE', it: 'it_IT' },
 *   default: 'de',
 * });
 * ```
 */
export function defineLanguages<
  const G extends Locales,
  const D extends Extract<keyof G, string>,
>(options: LanguagesOptions<G, D>): Languages<G, D> {
  const table = createTable(options.locales, options.default);

  // One function for the meta args and, through withArgs, for the props
  // and the preload args, so all three get the same language.
  function args(
    entry: TableEntry,
    location: Pick<Location, "pathname">
  ): RouteArgsExtension {
    // SAFETY: an entry's language and the language of a path are both
    // among the site's languages, which Lang lists.
    return {
      lang: entryLang(entry) ?? langOf(table, location.pathname),
    } as RouteArgsExtension;
  }

  return {
    locales: options.locales,
    default: options.default,
    pages: (pages) => {
      const expanded = expandPages(pages, table.order);
      setRoutes(table, expanded.routes);

      return withArgs(withPageLang(expanded.pages), args);
    },
    args,
    announced: (path) => langOf(table, path) === table.default,
    head: (entry, meta) => languageHead(table, entry, meta),
    alternates: (entry, announced) =>
      announcedAlternates(table, entry, announced),
    state: (entry, meta) => pageLanguages(table, entry, meta).paths ?? {},
    root: (state, children) => languageRoot(table, state, children),
    paths: () => langPaths(table),
  };
}
