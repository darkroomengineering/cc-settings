---
name: i18n
description: How a visio site serves pages in more than one language with @visio/i18n - defineLanguages() in src/routes.ts, each route's path in each language, props.lang, paths(lang), translations() from the page's data, the 404 for a missing translation, hreflang alternates, the language switcher (useTranslations), the banner (useSuggestedLang), interface words (defineStrings, useStrings), and <html lang>. Read before you add a language, a translated route, a language switcher, or interface words in more than one language.
---

# @visio/i18n

A site in one language does not use this package. Design: `i18n/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project). Translated content from Sanity (the Studio's languages, translated documents, `TRANSLATIONS`): the `sanity` skill, `references/languages.md`.

```ts
// src/routes.ts
import { defineLanguages } from "@visio/i18n";

export const languages = defineLanguages({
  locales: { de: "de_DE", it: "it_IT", en: "en_GB" }, // tag: og:locale
  default: "de",
});

declare module "@visio/i18n" {
  interface Register {
    languages: typeof languages;
  }
}

export const routes = defineRoutes(
  [
    page("/", () => import("./pages/home"), { it: "/it", en: "/en" }),
    page("/projekte/:slug", () => import("./pages/reference"), {
      it: "/it/progetti/:slug",
      en: "/en/projects/:slug",
    }),
    page("/impressum", () => import("./pages/imprint")), // German only
    catchAll(() => import("./pages/not-found")),
  ],
  { extensions: [languages] }
);

export const { Router, paths } = routes;
```

```ts
// vite.config.ts: the build's checks and every language's paths
import { i18n } from "@visio/i18n/vite";
import { vercel } from "@visio/vercel";

visio({ deploy: vercel(), extensions: [i18n()] });
```

- **The tag is the prefix.** The default language has none; every other path starts with `/<tag>`. Write the full path with its prefix. Keep the params: a page has the same params in every language, only the words change.
- **No third argument means the default language only.** Add a language to a route on purpose.
- **Links:** `paths(props.lang).projekte(slug)()`, with the last call as in the `router` skill. Never build a prefix by hand. A switcher link carries `hreflang`. `props.lang` is any of the site's languages, so `paths(props.lang)` has only the routes that exist in every language. For a route in some languages, pass a literal (`paths('it')`), or use the page's `useTranslations()`.
- **A page reads `props.lang`**; `preload`, `meta` and `translations` get `lang` too. A component reads `useLang()`: in a page, the page's own language, which stays the same while the page leaves; in the shell, the current page's. Never pass `lang` down as a prop for interface words. Lint rejects `useLang()` and `useStrings()` under `pages/`.
- **Data decides where a page exists.** A translated route with a preload declares `translations`: the page's params in each language it exists in, from the data that links the translations (a translation group or document ID in the CMS), never by matching slugs.

  ```ts
  export const route = defineRoute("/projekte/:slug", {
    preload: ({ params, lang }) => getReference(params.slug, lang),
    translations: ({ data }) =>
      data &&
      Object.fromEntries(
        data.translations.map((t) => [t.lang, { slug: t.slug }])
      ),
    meta: ({ data }): Meta => ({ title: data?.title ?? "" }),
  });
  ```

  A route that lists its pages with `announce` may give each entry `translations` in the same shape, from the same translation group: the page's language versions for the sitemap. The build checks them against the page's alternates (`ANNOUNCE_HEAD_DIFFERS`, the `router` skill).

- **A missing translation is a 404.** When `translations` leaves out the page's own language (the read found nothing), the router answers 404 with `noindex`, and the page renders its not-found state from `props.data`. Never fall back to the default language's content: it would be duplicate content under another URL. The read takes `lang` as an argument, so a cached `prerendered()` read is cached per language. The build does not need every page in every language: the crawl renders a page in another language only when a page that exists names it, so a language can grow page by page. A link (`<a href>`) to a missing translation still fails the build.
- **The head comes by itself:** `og:locale`, `og:locale:alternate`, and a `hreflang` link for each language the page exists in, plus `x-default`. Write `<html lang={lang()} dir={dir()}>` in `src/document.tsx`, with `lang` and `dir` from `@visio/i18n`: `dir` is `rtl` for a language written right to left (Arabic, Hebrew, Persian, Urdu), and both follow a navigation. Never set `dir` by hand. Do not set `site.locale` in `vite.config.ts`. The sitemap lists the same language versions for each page.
- **Switcher:** `useTranslations()` is the page's path in each language it exists in. **Banner:** `useSuggestedLang()` gives `{ lang, href }` when the visitor prefers another language the page exists in; mark the banner `data-agent="skip"`. Never redirect by `Accept-Language`.
- **Interface words** (a button, a label, a form's options) are one `defineStrings({ de: {...}, it: {...} })` in `src/lib/strings.ts`, exported as `strings`. The default language is the model: each other language has the same keys, a list of the same length, and a function with at most the same parameters, or it is a type error. Write each language inside the call, never `defineStrings({ de, it })` from separate consts: the lengths and the extra keys are then not checked. A component calls `const words = useStrings(strings)` and reads `words().nav.home`; a page, `preload`, `meta` and an API route read `strings[lang]`. There is no fallback to the default language.
  - An option that a form stores is a record by key (`{ staff: "Personal", clients: "Kunden" }`), never a list: the form stores the key, so a language's order cannot change the answer.
  - Text that a language splits in another way (paragraphs, steps of another count), and words an editor changes, go in the CMS (the `sanity` skill, `references/languages.md`). A word that is the same in each language (a brand name) is a constant outside `strings`.
  - The dev terminal warns on a shape that the type misses (a spread, a cast), on the first `useStrings()` of the server, with a `STRINGS_*` code (a missing or unknown key or language, a list of another length, a value of another kind). Fix the language it names.
- A match filter with a list of words (`/:slug` filtered to `impressum|datenschutz`) does not work on a translated route; write one `page()` per word.
