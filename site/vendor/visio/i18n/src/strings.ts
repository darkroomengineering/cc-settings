import { isDev, isServer } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { useLang } from "./context.ts";
import type { DefaultLang, Lang } from "./languages.ts";
import { siteTable } from "./table.ts";

/** What every language gives where the default language has `T`. */
export type StringsOf<T> = T extends (...args: infer A) => string
  ? (...args: A) => string
  : T extends string
    ? string
    : { readonly [K in keyof T]: StringsOf<T[K]> };

/** The words of `defineStrings()`, by language. */
export type Strings<D = unknown> = { readonly [L in Lang]: StringsOf<D> };

/** What `defineStrings()` takes: the default language, and every other one in its shape. */
export type StringsInput<D> = string extends Lang
  ? {
      "[@visio/i18n] [LANGUAGES_NOT_REGISTERED]": "defineStrings() needs the site's languages: declare module '@visio/i18n' { interface Register { languages: typeof languages } } in src/routes.ts (.claude/skills/i18n/SKILL.md).";
    }
  : { readonly [L in DefaultLang]: D } & {
      readonly [L in Exclude<Lang, DefaultLang>]: NoInfer<StringsOf<D>>;
    };

/** The site's interface words in each language, every language in the default language's shape. */
export function defineStrings<const D extends object>(
  strings: StringsInput<D>
): Strings<D>;
export function defineStrings(strings: Strings): Strings {
  return strings;
}

/** The words of the page's language. */
export function useStrings<S extends Strings>(
  strings: S
): Accessor<S[keyof S]> {
  const lang = useLang();

  // The browser's console reaches the dev terminal too, once per page load.
  if (isDev && isServer) {
    warnStrings(strings);
  }

  // SAFETY: Lang is the key type of Strings.
  return () => strings[lang() as keyof S];
}

const checked = new WeakSet<object>();

function warnStrings(strings: Strings): void {
  if (checked.has(strings)) {
    return;
  }

  checked.add(strings);
  const table = siteTable();

  for (const message of stringsFindings(strings, table.order)) {
    console.warn(message);
  }
}

type Kind = "a word" | "a function" | "a list" | "a group" | "another value";

function kindOf(value: unknown): Kind {
  if (typeof value === "string") {
    return "a word";
  }

  if (typeof value === "function") {
    return "a function";
  }

  if (Array.isArray(value)) {
    return "a list";
  }

  return typeof value === "object" && value !== null
    ? "a group"
    : "another value";
}

function where(at: string): string {
  return at ? `at ${at}` : "as a whole";
}

function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null
    ? Object.entries(value)
    : [];
}

function finding(code: string, message: string): string {
  return `[@visio/i18n] [${code}] defineStrings() ${message}`;
}

/** Where `other` differs in shape from `model`, the default language's value at `at`. */
function compare(
  model: unknown,
  other: unknown,
  at: string,
  langs: { first: string; lang: string }
): string[] {
  const { first, lang } = langs;
  const kind = kindOf(model);

  if (kind !== kindOf(other)) {
    return [
      finding(
        "STRINGS_KIND_DIFFERS",
        `has ${kindOf(other)} ${where(at)} in ${lang}, and ${kind} in ${first}. Write it as ${first} does.`
      ),
    ];
  }

  if (kind === "a list" && Array.isArray(model) && Array.isArray(other)) {
    if (model.length !== other.length) {
      return [
        finding(
          "STRINGS_LENGTH_DIFFERS",
          `has ${model.length} items ${where(at)} in ${first}, and ${other.length} in ${lang}. Each language has the same items; text that a language splits in another way goes in the CMS.`
        ),
      ];
    }

    return model.flatMap((item, i) =>
      compare(item, other[i], `${at}[${i}]`, langs)
    );
  }

  if (kind !== "a group") {
    return [];
  }

  const theirs = new Map(entriesOf(other));
  const found: string[] = [];

  for (const [key, value] of entriesOf(model)) {
    const path = at ? `${at}.${key}` : key;

    if (theirs.has(key)) {
      found.push(...compare(value, theirs.get(key), path, langs));
    } else {
      found.push(
        finding(
          "STRINGS_KEY_MISSING",
          `has no ${path} in ${lang}, which ${first} has, so the ${lang} page shows nothing there. Add the ${lang} word.`
        )
      );
    }
  }

  const ours = new Set(entriesOf(model).map(([key]) => key));

  for (const key of theirs.keys()) {
    if (!ours.has(key)) {
      found.push(
        finding(
          "STRINGS_KEY_UNKNOWN",
          `has ${at ? `${at}.${key}` : key} in ${lang}, which ${first} does not have. The default language is the model: add it to ${first}, or remove it.`
        )
      );
    }
  }

  return found;
}

/** The dev server's findings on `strings`, for the site's languages, the default first. */
export function stringsFindings(
  strings: Strings,
  order: readonly string[]
): string[] {
  const [first, ...others] = order;

  if (first === undefined) {
    return [];
  }

  const byLang = new Map(entriesOf(strings));
  const found: string[] = [];

  for (const lang of order) {
    if (!byLang.has(lang)) {
      found.push(
        finding(
          "STRINGS_LANGUAGE_MISSING",
          `has no ${lang}, one of the site's languages. Add its words.`
        )
      );
    }
  }

  for (const lang of byLang.keys()) {
    if (!order.includes(lang)) {
      found.push(
        finding(
          "STRINGS_LANGUAGE_UNKNOWN",
          `has ${lang}, which is not one of the site's languages (${order.join(", ")}). Remove it, or add it to defineLanguages().`
        )
      );
    }
  }

  if (!byLang.has(first)) {
    return found;
  }

  for (const lang of others) {
    if (byLang.has(lang)) {
      found.push(
        ...compare(byLang.get(first), byLang.get(lang), "", { first, lang })
      );
    }
  }

  return found;
}
