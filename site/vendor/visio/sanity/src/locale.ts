// Browser-safe and free of `sanity`: the Studio schema entry and the site both import it.

/** A locale type's `_type`: `locale` and a capital, so `localize()` finds it in any result. */
export type LocaleName = `locale${Capitalize<string>}`;

const LOCALE = /^locale[A-Z]/v;

/** What a query gives. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

/** No text: nothing, an empty string, or an empty list (Portable Text with no block). */
export function isEmpty(value: Json | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- text is a string or Portable Text, and only a string can be blank.
  if (typeof value === "string") {
    return value.trim() === "";
  }

  return Array.isArray(value) && value.length === 0;
}

function isLocale(value: { [key: string]: Json }): boolean {
  return LOCALE.test(String(value._type ?? ""));
}

/** The value of one language of a locale object. */
type LocaleValue<T> = NonNullable<T[Exclude<keyof T, "_type">]>;

/** A query result with each locale object replaced by the value of one language. */
export type Localized<T> = T extends { _type: `locale${string}` }
  ? Localized<LocaleValue<T>> | null
  : T extends object
    ? { [K in keyof T]: Localized<T[K]> }
    : T;

export function localize<T>(
  data: T,
  lang: string,
  fallback: string
): Localized<T> {
  function walk(value: Json): Json {
    if (Array.isArray(value)) {
      return value.map(walk);
    }

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a query result is any JSON; its scalars are kept as they are.
    if (typeof value !== "object" || value === null) {
      return value;
    }

    if (isLocale(value)) {
      const own = value[lang];
      const picked = isEmpty(own) ? value[fallback] : own;

      return picked === undefined || isEmpty(picked) ? null : walk(picked);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item)])
    );
  }

  // SAFETY: a query result is JSON, and walk() makes the shape that `Localized<T>` describes.
  return walk(data as Json) as Localized<T>;
}
