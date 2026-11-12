import type { MetaArgs } from "@visio/router";

import type {
  DefaultLang,
  Lang,
  TranslationParams,
  Translations,
} from "./languages.ts";
import type { LangPaths } from "./paths.ts";

export { useLang, useSuggestedLang, useTranslations } from "./context.ts";

export type { SuggestedLang } from "./context.ts";

export { defineLanguages } from "./languages.ts";

export { defineStrings, useStrings } from "./strings.ts";

export type { Strings } from "./strings.ts";

export type {
  DefaultLang,
  Lang,
  Languages,
  LanguagesOptions,
  Locales,
  Register,
  TranslationParams,
  Translations,
} from "./languages.ts";

export type { LangPaths, PathNode } from "./paths.ts";

export { dir, lang } from "./table.ts";

declare module "@visio/router/internal/extend" {
  interface RouteArgsExtension {
    /** The page's language: the default, or the prefix of its path. */
    readonly lang: Lang;
  }

  interface RouteOptionsExtension<P extends string, T> {
    /** The page's params in each language it exists in: `{ de: { slug: 'a' } }`. */
    readonly translations?:
      | ((args: MetaArgs<P, T>) => TranslationParams<P> | null | undefined)
      | undefined;
  }

  interface AnnounceFactsExtension<P extends string> {
    /** The page's params in each language it exists in, as `translations` of its route gives them. */
    readonly translations?: TranslationParams<P> | null | undefined;
  }

  interface EntryOptionsExtension {
    i18n: Translations;
  }

  interface PathsExtension<L extends readonly unknown[]> {
    paths: LangPaths<L, Lang, DefaultLang>;
  }
}
