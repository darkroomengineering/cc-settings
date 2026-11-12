// Not `coalesce(translationOf._ref, _id) == ...`: a coalesce() on each document cannot use an index.
export const TRANSLATIONS =
  '"translations": *[_type == ^._type && defined(language) && (_id == coalesce(^.translationOf._ref, ^._id) || translationOf._ref == coalesce(^.translationOf._ref, ^._id))]{ language, "slug": slug.current }';

/** One item of the `translations` that `TRANSLATIONS` projects. */
export interface TranslationItem {
  language: string | null;
  slug: string | null;
}

export interface TranslationParamsOptions {
  /** Default `true`. */
  params?: boolean;
}

/** The params of a page in each language, for the route's `translations` option. */
export function translationParams(
  list?: readonly TranslationItem[] | null,
  options?: TranslationParamsOptions
): Record<string, { slug?: string }> | undefined {
  if (!list) {
    return undefined;
  }

  const params: Record<string, { slug?: string }> = {};

  if (options?.params === false) {
    for (const { language } of list) {
      if (language) {
        params[language] = {};
      }
    }

    return params;
  }

  const slugged = list.some((item) => item.slug);

  for (const { language, slug } of list) {
    if (!language) {
      continue;
    }

    if (slug) {
      params[language] = { slug };
    } else if (!slugged) {
      params[language] = {};
    }
  }

  return params;
}
