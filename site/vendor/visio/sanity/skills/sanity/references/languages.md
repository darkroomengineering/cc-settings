# Languages

With `@visio/i18n` on (the `i18n` skill), the Studio declares the same languages, once:

```ts
// studio/schemaTypes/languages.ts
import { defineStudioLanguages } from "@visio/sanity/studio/schema";

export const languages = defineStudioLanguages({
  titles: { de: "Deutsch", it: "Italiano" },
  default: "de",
  fieldTitles: { language: "Sprache", translationOf: "Original" },
});
```

- `fieldTitles` and `messages` are optional, with English defaults. In a Studio in another language, set both: `messages: { originalMissing: (title) => ..., translationTaken: (title) => ... }` are the two messages of the `translationOf` check, each with a language's title.
- The keys of `titles` and `default` are the ones of `defineLanguages()` in `site/src/routes.ts`, as literals. The build compares the two (`STUDIO_LANGUAGES_DIFFER`), and stops when only one side has languages (`STUDIO_LANGUAGES_MISSING`, `SITE_LANGUAGES_MISSING`).
- **A field per language is the first choice.** A page, a project, an FAQ, settings: one document, each word a locale field, every image and reference once. Add `...languages.types` (`localeString`, `localeText`) to `schemaTypes`. For Portable Text or another type of the site, add `languages.locale({ name: "localeRichText", of: "richText" })`; the name is `locale` and a capital (`LOCALE_NAME_INVALID`). A list of words is a list of `localeString`. An image's alt text is a `localeString` field on the image. A field that needs text: `validation: languages.required`. Every locale field warns when only the default language has text.
- In the data layer, fetch the whole locale fields (`title`, not `title[$lang]` and not `title{de}`) and return `localize(result, lang, "<default>")` from `@visio/sanity`: each locale object becomes its text in `lang`, else in the default language, else null, and the type follows. The route's `translations` is `({ data, params }) => data && { de: params, it: params }`: the page exists in every language, with one slug.
- **A document per language** only for texts that differ by country, not translations of one text (a legal page): wrap the type in `languages.translated(defineType({ ... }))`. It adds `language` and `translationOf` (the original, in the default language) as the first fields. An original is always in the default language. A missing translation is then a 404.
- Content that already exists in the `sanity-plugin-internationalized-array` shape (`[{ _key, language, value }]`) keeps the plugin in `defineStudio({ plugins })`: typegen types its fields from the plugin. Read a field with a fragment function of the site's own in `src/lib/`, such as `` const localized = (field: string) => `${field}[language == $lang][0].value` ``; typegen follows it. visio has no helper for that shape: `localeString` is its own.
- A slug of a translated type: `options: { isUnique: languages.isUniqueInLanguage }`, so a translation may keep its original's slug.
- A reference from a translated type to a translated type: `options: { filter: languages.sameLanguage }`, so an Italian page picks Italian documents. On a type that is not translated it throws `SAME_LANGUAGE_TARGET_UNTRANSLATED`.
- Pass `languages` to `defineStudio({ ..., languages })`. A translated singleton is then one per language: `homePage` in the default language and `homePage-it`, linked as a translation. Each other translated type gets a list and a "new document" template per language. In a custom structure, `singleton('homePage')` lists all languages, `singleton('homePage', 'it')` one, and `languageList('project')` a translated type by language.

The page's query reads the document in `$lang`, never another one as a fallback, and lists its translations with `TRANSLATIONS`. The route passes them on with `translationParams()`:

```ts
// src/lib/queries.ts
import { defineQuery, TRANSLATIONS } from "@visio/sanity";

export const PROJECT_QUERY =
  defineQuery(`*[_type == "project" && slug.current == $slug && language == $lang][0]{
  ...,
  ${TRANSLATIONS}
}`);

// src/pages/project.tsx
import { translationParams } from "@visio/sanity";

export const route = defineRoute("/projects/:slug", {
  preload: ({ params, lang }) => getProject(params.slug, lang),
  translations: ({ data }) => translationParams(data?.translations),
  meta: ({ data }): Meta => ({ title: data?.headline ?? "" }),
});
```

`translationParams()` gives `{ de: { slug }, it: { slug } }`, `{ de: {}, it: {} }` for a singleton, and drops a translation that has no slug. The param is `slug`.

- A route with no param whose query finds a translation through its original's slug (one route per legal page, `/impressum` and `/it/note-legali`, with `coalesce(translationOf->slug.current, slug.current) == $slug`): `translationParams(data?.translations, { params: false })` gives `{ de: {}, it: {} }`. Without the option, a translation with no slug of its own is dropped, and its page answers 404.
- A route with another param maps `data.translations` itself.

Turning languages on for content that already exists: every document of a translated type needs `language` once, or `language == $lang` finds nothing and each page is a 404. `language` is read-only in the Studio once it has a value, so a wrong one cannot be fixed there: list each document with its language first, then set them with a script in `studio/`, run once:

```ts
// studio/set-language.ts: cd studio && node node_modules/.bin/sanity exec set-language.ts --with-user-token
import { getCliClient } from "sanity/cli";

/** The originals, in the default language. */
const ORIGINALS = ["homePage", "<project id>"];
/** The translations, by language: each document's id and its original's id. */
const BY_LANGUAGE = {
  it: { "homePage-it": "homePage", "<italian project id>": "<project id>" },
};

const client = getCliClient({ apiVersion: "2026-03-01" }).withConfig({
  perspective: "raw",
});
const tx = client.transaction();
// The published document, its draft and its release versions.
async function set(id: string, value: Record<string, unknown>) {
  const ids = await client.fetch<string[]>("*[sanity::versionOf($id)]._id", {
    id,
  });
  for (const each of ids) {
    tx.patch(each, (patch) => patch.set(value));
  }
}
for (const id of ORIGINALS) {
  await set(id, { language: "de" });
}
for (const [language, pairs] of Object.entries(BY_LANGUAGE)) {
  for (const [id, original] of Object.entries(pairs)) {
    await set(id, {
      language,
      translationOf: { _type: "reference", _ref: original },
    });
  }
}
await tx.commit();
```

Then delete the script.
