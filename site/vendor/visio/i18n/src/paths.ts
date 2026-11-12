import type { RouteDefinition, RouterInstance } from "@solidjs/router";

import { encodeParam, translatePath } from "./table.ts";
import type { LanguageTable } from "./table.ts";

/** The languages an entry exists in: the default, and each of its translated paths. */
type Available<E, D extends string> = E extends {
  readonly options: infer T;
}
  ? [T] extends [never]
    ? D
    : D | Extract<keyof T, string>
  : D;

type KeepIn<
  H,
  G extends string,
  D extends string,
  Acc extends readonly unknown[],
> = [G] extends [Available<H, D>]
  ? H extends { readonly children: infer C extends readonly unknown[] }
    ? readonly [
        ...Acc,
        Omit<H, "children"> & { readonly children: PagesIn<C, G, D, true> },
      ]
    : readonly [...Acc, H]
  : Acc;

/**
 * The entries that exist in every language of `G`, children included. An
 * index exists wherever its layout does, and the catch-all everywhere.
 * Tail-recursive, like the router's `Pages`.
 */
type PagesIn<
  L extends readonly unknown[],
  G extends string,
  D extends string,
  Nested extends boolean = false,
  Acc extends readonly unknown[] = readonly [],
> = L extends readonly [infer H, ...infer T]
  ? PagesIn<
      T,
      G,
      D,
      Nested,
      H extends { readonly path: "*404" }
        ? readonly [...Acc, H]
        : Nested extends true
          ? H extends { readonly path: "/" }
            ? readonly [...Acc, H]
            : KeepIn<H, G, D, Acc>
          : KeepIn<H, G, D, Acc>
    >
  : Acc;

type RouterPaths<P> = RouterInstance<
  P extends readonly RouteDefinition[] ? P : never
>["paths"];

/** `paths` on a site with languages: one builder per language, with the routes that exist in it. */
export type LangPaths<
  L extends readonly unknown[],
  G extends string,
  D extends string,
> = <const Lg extends G>(lang: Lg) => RouterPaths<PagesIn<L, Lg, D>>;

const HREF = Symbol.for("solid.Href");

type SearchValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[];

/** The search object of a typed path, `{ page: 2 }`. */
type SearchInput = Readonly<Record<string, SearchValue>>;

/** What a path node takes: params, then a search object and a hash. */
type PathArg = string | number | SearchInput;

/** A node of `paths(lang)`: a segment to go on from, or a call that ends in a path. */
export interface PathNode {
  (...args: readonly PathArg[]): PathNode | string;
  readonly [segment: string]: PathNode;
}

function isSearch(arg: PathArg): arg is SearchInput {
  return typeof arg === "object";
}

function isSymbol(prop: string | symbol): prop is symbol {
  return typeof prop === "symbol";
}

function searchString(params: SearchInput): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }

  const s = search.toString();

  return s ? `?${s}` : "";
}

/**
 * Solid Router's path proxy, built on the default language's segments,
 * whose result is the same route's path in `lang`. It keeps the proxy's
 * calls: params, then a search object and a hash, and the Href brand.
 */
function node(table: LanguageTable, pathname: string, lang: string): PathNode {
  function href(path = pathname, suffix = ""): string {
    return translatePath(table, path || "/", lang) + suffix;
  }

  function build(...args: readonly PathArg[]): PathNode | string {
    let path = pathname;

    for (const [i, arg] of args.entries()) {
      if (isSearch(arg)) {
        const hash = args[i + 1];

        return href(path, searchString(arg) + (hash ? `#${String(hash)}` : ""));
      }

      path += `/${encodeParam(arg)}`;
    }

    return args.length > 0 ? node(table, path, lang) : href();
  }

  // SAFETY: the proxy answers every string key with a node, as PathNode says.
  return new Proxy(build, {
    get(_, prop) {
      if (prop === HREF) {
        return href();
      }

      if (prop === "toString" || prop === Symbol.toPrimitive) {
        return () => href();
      }

      // Not a segment: no other symbol is part of a path.
      return isSymbol(prop) ? null : node(table, `${pathname}/${prop}`, lang);
    },
  }) as PathNode;
}

/** `paths(lang)` of a site with languages. */
export function langPaths(table: LanguageTable): (lang: string) => PathNode {
  return (lang) => node(table, "", lang);
}
