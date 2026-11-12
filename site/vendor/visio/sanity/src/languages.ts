import type {
  ConditionalPropertyCallbackContext,
  ReferenceFilterResolver,
  ReferenceFilterResolverContext,
  ReferenceFilterSearchOptions,
  SanityDocument,
  SchemaTypeDefinition,
  SlugIsUniqueValidator,
  SlugValidationContext,
  ValidationContext,
  Path,
} from "@sanity/types";

import { API_VERSION } from "./constants.ts";
import { isEmpty } from "./locale.ts";
import type { Json, LocaleName } from "./locale.ts";

/** The runtime mark of `translated()`, and its phantom type. */
export const TRANSLATED: unique symbol = Symbol.for("@visio/sanity/translated");

/** A document type that `translated()` returned. */
export interface Translated {
  readonly [TRANSLATED]: true;
}

/** What `translated()` takes: a document type from `defineType`. */
export interface TranslatableType {
  name: string;
  type: "document";
  title?: string;
  fields?: readonly unknown[];
  groups?: readonly { name: string; default?: boolean }[];
}

export interface StudioLanguagesOptions<Lang extends string> {
  /** The name an editor sees, by language tag of `defineLanguages()`. */
  titles: Record<Lang, string>;
  /** The language of the originals. */
  default: NoInfer<Lang>;
  /** The titles of the two fields `translated()` adds. Default "Language" and "Original". */
  fieldTitles?: { language?: string; translationOf?: string };
  messages?: {
    /** Default `A translation needs its original in ${title}.` */
    originalMissing?: (title: string) => string;
    /** Default `The original already has a translation in ${title}.` */
    translationTaken?: (title: string) => string;
    /** A locale field with no text in the default language. Default `Required in ${title}.` */
    defaultEmpty?: (title: string) => string;
    /** A warning: a locale field with text in the default language only. Default `No text in ${titles} yet: the site shows the ${fallback} text.` */
    untranslated?: (titles: string, fallback: string) => string;
  };
}

export interface StudioLanguages<Lang extends string = string> {
  readonly tags: readonly Lang[];
  readonly default: Lang;
  readonly titles: Readonly<Record<Lang, string>>;
  /** The document type with `language` and `translationOf` first. */
  translated: <const T extends TranslatableType>(type: T) => T & Translated;
  /** `localeString` and `localeText`, one field per language. */
  readonly types: readonly [
    LocaleType<"localeString">,
    LocaleType<"localeText">,
  ];
  /** A locale type of any field type, such as the site's own `richText`. */
  locale: <const Name extends LocaleName>(
    options: LocaleOptions<Name>
  ) => LocaleType<Name>;
  /** The `validation` of a locale field that needs text in the default language. */
  required: <R>(rule: LocaleRule<R>) => R[];
  /** The `isUnique` option of a slug: unique in its type and language. */
  isUniqueInLanguage: SlugIsUniqueValidator;
  /** The `filter` option of a reference to a translated type: the document's own language. */
  sameLanguage: ReferenceFilterResolver;
}

export interface LocaleOptions<Name extends LocaleName> {
  /** `locale` and a capital (`localeRichText`), so `localize()` finds it. */
  name: Name;
  /** The type of each language's field: `string`, `text`, or a type of the site. */
  of: string;
  /** Default "Text". */
  title?: string;
}

/** A locale field's value, one key per language. */
export type LocaleValue = Partial<Record<string, Json>>;

/** The part of Sanity's rule that the locale checks call; `R` is the rule itself. */
export interface LocaleRule<R = unknown> {
  custom: (
    fn: (value: LocaleValue | undefined) => string | true
  ) => R & { warning: () => R };
}

export interface LocaleType<Name extends LocaleName = LocaleName> {
  name: Name;
  type: "object";
  title: string;
  fields: {
    name: string;
    title: string;
    type: string;
    rows?: number;
  }[];
  validation: <R>(rule: LocaleRule<R>) => R;
}

export function isTranslated(
  type: SchemaTypeDefinition
): type is SchemaTypeDefinition & Translated {
  return Object.hasOwn(type, TRANSLATED);
}

function publishedId(id: string): string {
  if (id.startsWith("drafts.")) {
    return id.slice("drafts.".length);
  }

  if (id.startsWith("versions.")) {
    return id.split(".").slice(2).join(".");
  }

  return id;
}

function languageOf(document: SanityDocument | undefined): string | undefined {
  const language = document?.language;

  return typeof language === "string" ? language : undefined;
}

function refOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("_ref" in value)) {
    return;
  }

  return typeof value._ref === "string" ? value._ref : undefined;
}

/** A field's path as GROQ reads it, as Sanity's own unique check writes it: an array member is `[]`. */
function groqPath(path: Path): string {
  return path
    .map((part, i) => {
      if (typeof part !== "string") {
        return "[]";
      }

      return i === 0 ? part : `.${part}`;
    })
    .join("");
}

function isUniqueInLanguage(
  slug: string,
  context: SlugValidationContext
): Promise<boolean> | boolean {
  const { document, path } = context;

  if (!document || !path) {
    return true;
  }

  const language = languageOf(document);
  const at = groqPath([...path, "current"]);

  return context
    .getClient({ apiVersion: API_VERSION })
    .withConfig({ perspective: "raw" })
    .fetch<boolean>(
      `!defined(*[_type == $type && ${at} == $slug && ${language === undefined ? "!defined(language)" : "language == $language"} && !sanity::versionOf($id)][0]._id)`,
      {
        type: document._type,
        slug,
        language: language ?? null,
        id: publishedId(document._id),
      }
    );
}

export function defineStudioLanguages<const Lang extends string>(
  options: StudioLanguagesOptions<Lang>
): StudioLanguages<Lang> {
  // SAFETY: the keys of `titles` are `Lang`.
  const tags = Object.keys(options.titles) as Lang[];
  const first = options.default;

  if (!tags.includes(first)) {
    throw new Error(
      `[@visio/sanity] [STUDIO_LANGUAGE_DEFAULT_UNKNOWN] defineStudioLanguages() has default '${first}', which is not a key of titles (${tags.join(", ")}).`
    );
  }

  const titles = new Map<string, string>(Object.entries(options.titles));

  const originalMissing =
    options.messages?.originalMissing ??
    ((title: string) => `A translation needs its original in ${title}.`);

  const translationTaken =
    options.messages?.translationTaken ??
    ((title: string) => `The original already has a translation in ${title}.`);

  async function oneInLanguage(value: unknown, context: ValidationContext) {
    const { document } = context;
    const language = languageOf(document);

    if (!document || language === undefined || language === first) {
      return true;
    }

    const ref = refOf(value);

    if (!ref) {
      return originalMissing(titles.get(first) ?? first);
    }

    const taken = await context
      .getClient({ apiVersion: API_VERSION })
      .withConfig({ perspective: "raw" })
      .fetch<boolean>(
        "defined(*[_type == $type && language == $language && translationOf._ref == $ref && !sanity::versionOf($id)][0]._id)",
        {
          type: document._type,
          language,
          ref,
          id: publishedId(document._id),
        }
      );

    return taken ? translationTaken(titles.get(language) ?? language) : true;
  }

  function translated<const T extends TranslatableType>(
    type: T
  ): T & Translated {
    const group = type.groups?.find((g) => g.default)?.name;

    const language = {
      name: "language",
      title: options.fieldTitles?.language ?? "Language",
      type: "string",
      ...(group && { group }),
      options: {
        list: tags.map((tag) => ({ value: tag, title: options.titles[tag] })),
        layout: "radio",
        direction: "horizontal",
      },
      // A change of language would move the document out of its group.
      readOnly: ({ value }: ConditionalPropertyCallbackContext) =>
        value !== undefined,
      validation: (rule: { required: () => unknown }) => rule.required(),
    };

    const translationOf = {
      name: "translationOf",
      title: options.fieldTitles?.translationOf ?? "Original",
      type: "reference",
      to: [{ type: type.name }],
      ...(group && { group }),
      hidden: ({ document }: ConditionalPropertyCallbackContext) =>
        languageOf(document) === first,
      options: {
        disableNew: true,
        filter: "language == $language && !defined(translationOf)",
        filterParams: { language: first },
      },
      validation: (rule: { custom: (fn: typeof oneInLanguage) => unknown }) =>
        rule.custom(oneInLanguage),
    };

    return {
      ...type,
      fields: [language, translationOf, ...(type.fields ?? [])],
      [TRANSLATED]: true,
    };
  }

  const defaultEmpty =
    options.messages?.defaultEmpty ??
    ((title: string) => `Required in ${title}.`);

  const untranslated =
    options.messages?.untranslated ??
    ((names: string, fallback: string) =>
      `No text in ${names} yet: the site shows the ${fallback} text.`);

  // Only a warning: the site falls back to the default language (`localize()`).
  function missing(value: LocaleValue | undefined): string | true {
    if (isEmpty(value?.[first])) {
      return true;
    }

    const empty = tags.filter((tag) => tag !== first && isEmpty(value?.[tag]));

    return empty.length === 0
      ? true
      : untranslated(
          empty.map((tag) => options.titles[tag]).join(", "),
          options.titles[first]
        );
  }

  function locale<const Name extends LocaleName>({
    name,
    of,
    title,
  }: LocaleOptions<Name>): LocaleType<Name> {
    if (!/^locale[A-Z]/v.test(name)) {
      throw new Error(
        `[@visio/sanity] [LOCALE_NAME_INVALID] locale() got the name '${name}'. It must be 'locale' and a capital (localeRichText), so localize() finds its values.`
      );
    }

    return {
      name,
      type: "object",
      title: title ?? "Text",
      fields: tags.map((tag) => ({
        name: tag,
        title: options.titles[tag],
        type: of,
        ...(of === "text" && { rows: 3 }),
      })),
      validation: (rule) => rule.custom(missing).warning(),
    };
  }

  // A field's own `validation` replaces its type's, so the warning comes along.
  function required<R>(rule: LocaleRule<R>): R[] {
    return [
      rule.custom((value) =>
        isEmpty(value?.[first]) ? defaultEmpty(options.titles[first]) : true
      ),
      rule.custom(missing).warning(),
    ];
  }

  function sameLanguage({
    document,
  }: ReferenceFilterResolverContext): ReferenceFilterSearchOptions {
    return {
      filter: "language == $language",
      params: { language: languageOf(document) ?? first },
    };
  }

  return {
    tags,
    default: first,
    titles: options.titles,
    translated,
    types: [
      locale({ name: "localeString", of: "string" }),
      locale({ name: "localeText", of: "text" }),
    ],
    locale,
    required,
    isUniqueInLanguage,
    sameLanguage,
  };
}
