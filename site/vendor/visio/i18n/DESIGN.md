# @visio/i18n design

A site in more than one language. Each language has its own words in its paths: `/projekte/:slug`, `/it/progetti/:slug`, `/en/projects/:slug`. The package plugs into the seams of `@visio/router` (`router/DESIGN.md`, Extensions), so a site in one language does not import it and bundles none of its code.

## Turning it on

The site imports the package twice, once for the runtime and once for the build.

```ts
// src/routes.ts
import { defineLanguages } from "@visio/i18n";

export const languages = defineLanguages({
  locales: { de: "de_DE", it: "it_IT", en: "en_GB" },
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
// vite.config.ts
import { i18n } from "@visio/i18n/vite";
import { vercel } from "@visio/vercel";

export default defineConfig({
  plugins: [visio({ deploy: vercel(), extensions: [i18n()] })],
});
```

- **The key of `locales` is the language tag**: the `hreflang`, the `<html lang>` and the URL prefix (`/it`). It is two or three lowercase letters, with no region: Google reads a language without a region, and the URL stays short. The value is the `og:locale` (`ll_CC`, from Facebook's fixed list). There is no `prefix` option, because the tag is the prefix. The default language has no prefix, so `/de/...` is a 404 and not a second copy of the German site.
- **The first argument of `page()` is the default-language path.** It is also the pattern that the module declares and the key in `paths`, so every check of the router works as before. The third argument gives the other languages, each path in full with its prefix, so the table shows the real URLs. A route without a third argument exists in the default language only: a site adds a language to a route on purpose. Every route has a path in the default language.
- **`layout()` takes the same object after its children.** A child's path in a language must be under its layout's path in that language. An `index()` exists in each language of its layout.
- **`defineLanguages()` is a top-level `const`, and `Register` names it.** The build reads it from the source (`LANGUAGES_NOT_STATIC`). `Register` gives `Lang`, the union of the tags, to `props.lang`, `preload`, `meta`, `translations` and `paths(lang)`. It registers the languages and not the table: a page's types read `Lang`, and the table's type reads the pages, so `typeof routes` is a cycle (TS7022 on every page that reads `lang` in its `preload` or `meta`). Without `Register`, `Lang` is `string`, and the build stops with `LANGUAGES_NOT_REGISTERED`.

## At runtime

The extension uses the router's hooks:

- **`pages`** gives Solid Router one route for each language a page has a path in, the default language first (`expandPages()` in `expand.ts`). Each copy has its language and the route's pattern in every language. The catch-all comes once. A default-language route at the top whose first segment is a param (`/:slug`) gets a match filter that rejects the other languages' tags, so `/it` never matches it as a German page. Each page and layout renders inside a context with its `props.lang`, for `useLang()` (below). Then `withArgs()` adds `lang` to the props and the preload args. The same function is the extension's `args`, which the router adds to the meta args, so the three always agree. The catch-all takes its language from the prefix of the URL, so a miss under `/it/...` renders the 404 page in Italian.
- **`head`** gives the page's `og:locale`, and its alternates (below), or a 404.
- **`state`** and **`root`** give the components the page's path in each language (`useTranslations()`), and keep `<html lang>` and `dir` current after a navigation. The attribute follows the address, so during a page transition the outgoing page is under the new language for a moment. Only a screen reader can notice this, and only during the animation, so the package accepts it.
- **`paths`** replaces Solid Router's builder with `paths(lang)`.

**The language of a path** is its first segment when that is a language other than the default, else the default (`langOf()` in `table.ts`). So a default-language path may not start with another language's prefix (`PATH_UNDER_LANGUAGE`). `lang()` gives the language of the request for `<html lang>` in `src/document.tsx`: the request's path on the server, the address in the browser. It reads the table that `defineLanguages()` made when `src/routes.ts` loaded, because the document has no router; before that, it throws `LANGUAGES_UNDEFINED`. `dir()` gives that language's text direction for `<html dir>`, and the root sets `dir` with `lang` after a navigation. The direction is the one of the language's usual script: `Intl.Locale(tag).maximize().script` against the scripts Unicode writes right to left (`dirOf()`). `getTextInfo()` would say it directly, but not every browser has it, and the direction has to be the same on the server and in the browser. A key has no script subtag, so a language written in two scripts takes its usual one.

**`paths(lang)`.** On a site with languages, `paths` takes a language first: `paths(props.lang).projekte(slug)()`. The keys are the default language's words. The builder is Solid Router's proxy rebuilt (`node()` in `paths.ts`): it builds the default-language path, matches it against the routes, the most specific first and with each route's match filters, and fills the same route's pattern in the other language with the same params. A bare `paths.projekte()` does not type-check, so a link cannot forget its language. With a literal language, only the routes that exist in that language are on the builder. With `Lang`, only the routes that exist in every language are on it. A route that is not in the language throws `ROUTE_NOT_IN_LANGUAGE`, and a path that matches no route throws `PATH_NOT_ROUTED`; only an untyped call can reach them. `props.lang` is `Lang`, every language of the site, so `paths(props.lang)` has only the routes in every language. For a route in some languages, pass a literal (`paths('it')`), or link through `useTranslations()`.

## Where a page exists

A route option, `translations`, gives the page's params in each language where it really exists, from its data:

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

The data links the pages, not a slug match: the slugs differ by language, and a CMS knows which documents are one page. A route without `translations` exists in every language of its table entry, with the same params. A translated route with a `preload` must declare it (`ROUTE_NEEDS_TRANSLATIONS`): when data decides that a page exists, data decides in which languages. An `index()` is translated when its layout is. A layout has no `translations`, and its own data cannot change in which languages its pages exist: each page decides that for itself. A language that `translations` names but the table does not warns `TRANSLATION_PATH_MISSING` in dev.

**A missing translation is a 404, never a fallback.** When `translations` does not name the page's own language, the router answers 404 with `noindex` and no alternate links. A German document under `/it/...` would be duplicate content. The router sets the status in the head's memo, which the title waits for, so it is set before the shell flushes. The page renders its own not-found state from `props.data`. A query reads the document of the page's language and never falls back to another one. A CMS document that holds every language in its fields is one page in every language: its empty fields fall back, and the document is not missing (`sanity/DESIGN.md`, Fields in the query). A list of words as a match filter (`/:slug` filtered to `impressum|datenschutz`) cannot be translated, because the words differ by language: the build rejects it on a translated route (`MATCH_FILTER_NOT_TRANSLATABLE`), and the site writes one route for each word.

**The head** of a page has its `og:locale`, an `og:locale:alternate` for each other language it exists in, and a `<link rel="alternate" hreflang>` for each language it exists in, itself included, with `x-default` to the default-language page when that exists. A page in one language gets no alternates, and the router drops them on a `noindex` page. The tags are keyed, because the head identifies a meta tag by its property and a link by its href. `site.locale` of `visio()` on a site with languages stops the build (`SITE_LOCALE_CONFLICTS`): each language has its own locale.

## For the components

`useTranslations()` is the current page's path in each language it exists in, for a language switcher. Its read waits for the page's data like any other async read, so the server renders the switcher with the links, and the browser hydrates the same links. A language that the page has no translation in is absent; the site decides what its switcher shows for it.

`useSuggestedLang()` is a language that the visitor prefers (`navigator.languages`) and that the page exists in, when it is not the page's own, for a banner that offers it. It is undefined on the server and before the page settles, so it never changes the server HTML. Nothing redirects by `Accept-Language` or by IP: each crawler gets one URL per language.

`useLang()` is the language of the page a component renders in, for its interface words. The page gives it from its `props.lang`, so it stays the same while the page leaves during a page transition, and a section does not take the language as a prop. In the shell (a nav, a footer), outside every page, it is the current page's language, and it notifies only when the address changes language, not on every navigation. A page reads `props.lang`, and lint rejects `useLang` under `pages/`.

## Interface words

Before `defineStrings()`, a site's interface words (a button, a label, a form's options) were a hand-written `src/lib/strings.ts`: `{ de: {...}, it: {...} } satisfies Record<Lang, ...>`. `satisfies` checks that each language is there, but not that the languages have the same keys. The first i18n site wrote its own types for that (`const de = {...}`, `type Strings = typeof de`, `const it: Strings = {...}`). Each site wrote the same file again, and two problems stayed:

- **A key that is in one language only.** With `satisfies`, a word that is missing in Italian is found only on the Italian page.
- **A stored option by its index.** A form that stores the default-language option at the index of the chosen one stores the wrong answer when another language has its options in a different order, or a shorter list. No check finds it.

### The API

```ts
// src/lib/strings.ts
import { defineStrings } from "@visio/i18n";

export const strings = defineStrings({
  de: {
    nav: { home: "Startseite", open: "Menü öffnen" },
    form: { priorities: { staff: "Personal", clients: "Kunden", both: "Beides" } },
    steps: ["Anfrage", "Gespräch", "Angebot"],
    reachAlt: (client: string, period: string) => `Reichweite ${client}, ${period}`,
  },
  it: {
    nav: { home: "Home", open: "Apri il menu" },
    form: { priorities: { staff: "Personale", clients: "Clienti", both: "Entrambi" } },
    steps: ["Richiesta", "Colloquio", "Offerta"],
    reachAlt: (client, period) => `Copertura ${client}, ${period}`,
  },
});

// in a component
const words = useStrings(strings);
<button aria-label={words().nav.open} />;

// in a page, preload, meta or an API route: the plain object
strings[props.lang].nav.home;
```

- **`defineStrings()` returns its argument**, typed as `Strings`: a `Record<Lang, ...>`. So the server, `meta` and an API route index it by a language, with no helper.
- **The default language is the model.** The type parameter is `const`, so a list is a tuple, and only the default language infers it: the other languages are `NoInfer<>`, so their functions take their parameter types from it. Each other language must have the same shape: the same keys, a `string` for each string, a tuple of strings with the same length for each list, and a function that returns a string and takes at most the default language's parameters (a language may leave a value out, as TypeScript allows any function with fewer parameters). A missing key or a list of another length is a type error at the key. The tags come from `Register`, so a language of `defineLanguages()` that is missing is a type error too.
- **The languages are written inside the call.** `const` acts only on a literal written there. From separate consts (`defineStrings({ de, it })`), a list of `de` is a `string[]`, so the lengths are not compared, and TypeScript does not check the extra keys of `it`. The dev check below finds those, and only there.
- **Every list has the same length in each language.** Text that a language splits in another way (paragraphs, steps of another count) is content, and goes in the CMS.
- **An option that a form stores is a record by key, never a list.** The form stores the key (`clients`), and each language gives its label. Then the order of the options in one language cannot change the stored answer, and the keys are the same in each language by the type.
- **Before `Register`, the argument is a type error with a message:** `Lang` is `string` then, so there is no default language to model the others on. The message says to register the languages (the i18n skill), as the build's `LANGUAGES_NOT_REGISTERED` does.
- **The dev server checks the same shape at runtime**, on the first `useStrings()` of a `Strings`, because the site's languages are known only after `defineLanguages()` runs, and `strings.ts` can load first (`app.tsx` imports the nav before the routes). It runs on the server only, because the browser's console reaches the dev terminal too, once per page load. It warns once per object and server process, and does not stop the page: `STRINGS_KEY_MISSING`, `STRINGS_KEY_UNKNOWN`, `STRINGS_LENGTH_DIFFERS`, `STRINGS_KIND_DIFFERS` (a word in one language, a function, a group or a list in another), `STRINGS_LANGUAGE_MISSING` and `STRINGS_LANGUAGE_UNKNOWN`, each with the key path and the language. The type is the first check, but Vite does not run `tsc`, so an agent that only runs `bun run dev` sees the message too. The production build does not run it. A page that reads only `strings[props.lang]` gets no runtime check; the type still holds there.
- **`useStrings(strings)`** calls `useLang()` once, in the component body, and returns `() => strings[lang()]`. So it follows the page's language as `useLang()` does, and the accessor can be read in an event handler. A page reads `strings[props.lang]`: lint rejects `useStrings` under `pages/`, as it does `useLang`.
- **No fallback.** A word that is missing in a language is an error, never the default language's word. A German word on an Italian page is the bug that the types prevent.

### A word that is the same in each language

The package adds nothing for it. A word that does not change with the language (a brand name, a number) is not an interface word: it is a constant outside `strings` (`BRAND`). A shared part that `defineStrings()` merges into each language would make the type a deep merge, and the shape check would then accept a key in two places.

### Not in it

- Plural rules and number or date formats: `Intl.PluralRules`, `Intl.NumberFormat` and `Intl.DateTimeFormat` with the page's locale.
- Words from the CMS: a settings document per language, or `localeString` (the `sanity` skill, `references/languages.md`).
- Strings in their own JSON files, keys as strings (`t("nav.home")`), or a lazy load per language. The words of a site are small, and the typed object gives each key its own type.

### Where it is

`src/strings.ts`. The types are tested in their own program with the languages registered (`test/site/routes.ts`) and without them (`test/unregistered/`), the check and `useStrings()` in `strings.test.ts`. The check walks values of any shape, so lint lists the file with the parsing boundaries. The lab's languages case reads its words from `defineStrings()` (`lab/src/lib/strings.ts`), and its `useLang()` line shows a word from `useStrings()`.

## The build

`i18n()` gives `visio()` the routes part of the extension:

- **`sitePaths`**: a site's translated paths, and an index's are its layout's. The route facts then hold every language's patterns, so the cache, `live` and `pending` work per language, and the duplicate check covers every language. The crawl reaches the pages of other languages through the pages that exist (below). A test (`checks.test.ts`) builds one table both ways and checks that the build's paths are the runtime's pages.
- **`diagnostics`**: `LANGUAGES_MISSING`, `LANGUAGES_NOT_STATIC`, `LANGUAGES_NOT_PASSED` (not in `extensions` of `defineRoutes()`), `LANGUAGES_NOT_REGISTERED`, `LANGUAGE_TAG_INVALID`, `LANGUAGE_LOCALE_INVALID`, `LANGUAGE_DEFAULT_UNKNOWN`, `SITE_LOCALE_CONFLICTS`, `TRANSLATIONS_NOT_STATIC`, `TRANSLATION_LANGUAGE_DEFAULT`, `TRANSLATION_LANGUAGE_UNKNOWN`, `TRANSLATION_PREFIX_MISSING`, `TRANSLATION_PARAMS_DIFFER` (a page has the same params in every language), `TRANSLATION_OUTSIDE_LAYOUT`, `PATH_UNDER_LANGUAGE`, `ROUTE_NEEDS_TRANSLATIONS` and `MATCH_FILTER_NOT_TRANSLATABLE`.

**The crawl** must not fail on a missing translation, so the table does not announce the other languages. `announced` keeps the default language's static pages in the route announcement, and the head of each page announces the page in its other languages (`announce` of the head), from `translations`. So the crawl renders a page in a language only when the page exists in it, and adds a language one page at a time. A link (`<a href>`) to a missing translation still stops the build. A default-language page that answers 404 stops it too: every route has a path in the default language. `packages/visio/test/i18n-crawl.test.ts` builds a site with a page that has no Italian translation.

`src/entry.ts` is the one place that reads the fields the router types `unknown` (an entry's options and its module's route), so lint lists it with the other parsing boundaries.

## Sanity

The Sanity side is in `@visio/sanity`, so this package has no Sanity dependency (`sanity/DESIGN.md`, Languages). `i18n()` gives the site's languages to its build as `languages` of the extension (the tags and the default, from the same `readLanguages()` as the table's checks), and `visio()` passes them to `connect` of `sanity()`, for the Studio's check.

## Not built yet

The crawl's checks that every alternate is a crawled page and links back, and `llms.txt` per language.
