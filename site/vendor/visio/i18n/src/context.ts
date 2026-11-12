import { useLocation } from "@visio/router";
import {
  createContext,
  createMemo,
  createSignal,
  onSettled,
  useContext,
} from "solid-js";
import type { Accessor } from "solid-js";

import type { PagePaths } from "./head.ts";
import type { Lang } from "./languages.ts";
import { langOf, siteTable } from "./table.ts";

/** The current page's path in each language it exists in. */
export const Translated = createContext<Accessor<PagePaths>>(() => ({}));

/**
 * The current page's path in each language it exists in, its own included,
 * for a language switcher. A language the page has no translation in is
 * absent: link that language's home, or nothing.
 */
export function useTranslations(): Accessor<
  Readonly<Partial<Record<Lang, string>>>
> {
  return useContext(Translated);
}

/** The language of the page a component renders in; null in the shell. */
// Not undefined: Solid reads an undefined default as no default, and throws.
export const PageLang = createContext<Accessor<string> | null>(null);

/** The language of the page a component renders in; in the shell, the address's. */
export function useLang(): Accessor<Lang> {
  const page = useContext(PageLang);

  if (page) {
    // SAFETY: a page's language is one of the site's languages, which Lang lists.
    return page as Accessor<Lang>;
  }

  const location = useLocation();
  const table = siteTable();

  // SAFETY: langOf() gives one of the site's languages, which Lang lists.
  return createMemo(() => langOf(table, location.pathname) as Lang);
}

/** A language the visitor prefers and the current page exists in. */
export interface SuggestedLang {
  lang: Lang;
  /** The page in that language. */
  href: string;
}

/** A language the visitor prefers that the page exists in, for a banner; undefined on the server. */
export function useSuggestedLang(): Accessor<SuggestedLang | undefined> {
  const translations = useTranslations();
  const current = useLang();
  const [preferred, setPreferred] = createSignal<readonly string[]>([]);
  onSettled(() => {
    setPreferred(
      navigator.languages.map((tag) => tag.toLowerCase().split("-")[0] ?? "")
    );
  });

  return createMemo(() => {
    const hrefs: Readonly<Partial<Record<string, string>>> = translations();
    const here = current();

    const tag = preferred().find(
      (preference) => preference === here || hrefs[preference] !== undefined
    );

    const href = tag === undefined ? undefined : hrefs[tag];

    // SAFETY: a key of the page's translations is one of the site's languages.
    return tag !== here && href ? { lang: tag as Lang, href } : undefined;
  });
}
