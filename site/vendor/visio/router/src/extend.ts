import type {
  Location,
  RoutePreloadFuncArgs,
  RouteSectionProps,
} from "@solidjs/router";
import type { HeadTag, JSX } from "@solidjs/web";
import { createComponent } from "solid-js";
import type { Accessor, Component } from "solid-js";

import type { ChainLevel } from "./chain.ts";
import type { HeadMeta, Meta, MetaArgs } from "./meta.ts";

export { relativeTo } from "./pattern.ts";

/** The language tags of the site and its default one: what `i18n()` reads from the table, for `visio()` and the Studio's check. */
export interface SiteLanguages {
  tags: string[];
  default: string;
}

// ---------------------------------------------------------------------------
// Types an extension merges into, with `declare module
// "@visio/router/internal/extend"`. A site that imports no extension sees
// them empty.

/** Fields every page and layout gets in its props, its preload args and its meta args. */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- an extension's declaration fills it.
export interface RouteArgsExtension {}

/** Options `defineRoute()` takes besides the router's own. */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type, no-unused-vars -- an extension's declaration fills it, and may read P and T.
export interface RouteOptionsExtension<P extends string, T> {}

/** Fields a page's `meta` may return besides the router's own, such as `theme`. */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- an extension's declaration fills it.
export interface MetaExtension {}

/** The last argument of `page()` and `layout()`, one key per extension: `{ i18n: Translations }`. */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- an extension's declaration fills it.
export interface EntryOptionsExtension {}

/** Fields an entry of `announce` may give besides the router's own facts: `{ translations }`. */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type, no-unused-vars -- an extension's declaration fills it, and may read P.
export interface AnnounceFactsExtension<P extends string> {}

/**
 * `paths` of `defineRoutes()` in place of Solid Router's, as `{ paths: X }`,
 * where `X` may read the page tree `L`.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type, no-unused-vars -- an extension's declaration fills it, and may read L.
export interface PathsExtension<L extends readonly unknown[]> {}

/**
 * The type of the last argument of `page()` and `layout()`; never without
 * an extension. No `path`: the plugin's route after it is told apart by it.
 */
export type EntryOptions = [keyof EntryOptionsExtension] extends [never]
  ? never
  : EntryOptionsExtension[keyof EntryOptionsExtension] & {
      readonly path?: never;
    };

// ---------------------------------------------------------------------------
// The hooks

/** A table entry as `defineRoutes()` gives it to an extension. */
export interface TableEntry {
  /** The path Solid Router matches: relative to the parent layout. */
  readonly path: string;
  /** The full pattern `page()` or `layout()` was called with; absent on an index and the catch-all. */
  readonly pattern?: string;
  /** The last argument of `page()` or `layout()`; see `EntryOptionsExtension`. */
  readonly options?: unknown;
  /** The page module's `route`, with the options extensions read; absent without the plugin and on the catch-all. */
  readonly route?: object | undefined;
  readonly component: Component<RouteSectionProps>;
  readonly preload?: ChainLevel["preload"];
  readonly meta?: ((args: MetaArgs) => Meta) | undefined;
  readonly matchFilters?: unknown;
  readonly info?: object;
  readonly children?: readonly TableEntry[];
}

/** The head fields an extension sets for the current page. */
export type HeadFields = Pick<HeadMeta, "locale" | "noindex">;

/** What an extension's `head` gives for the current page. */
export interface HeadAddition {
  readonly meta?: HeadFields;
  /** Its own tags, each with a `key`; dropped when the page is not to index. */
  readonly tags?: readonly HeadTag[];
  /** Its own tags, each with a `key`, on every page: what the page looks like, not an address. */
  readonly always?: readonly HeadTag[];
  /** The page does not exist: status 404 on the server, and `noindex`. */
  readonly notFound?: boolean;
  /** More paths for the crawl. */
  readonly announce?: readonly string[];
}

export interface RouterExtension<S = unknown> {
  /** The page tree before the router is made: an extension may add, drop or change entries. */
  readonly pages?: (pages: readonly TableEntry[]) => readonly TableEntry[];
  /**
   * The fields of `RouteArgsExtension` for an entry, the same keys at every
   * location: the router adds them to the meta args; `withArgs` in `pages`
   * adds them to the props and the preload args.
   */
  readonly args?: (
    entry: TableEntry,
    location: Pick<Location, "pathname">
  ) => RouteArgsExtension;
  /** `false` keeps a static page out of the route announcement. */
  readonly announced?: (path: string) => boolean;
  /** Head fields, its tags and a 404, from the page's entry and its meta args. */
  readonly head?: (
    entry: TableEntry,
    args: MetaArgs
  ) => HeadAddition | undefined;
  // Methods, not properties: an extension's own state type then fits the
  // `extensions` list, which holds RouterExtension<unknown>.
  /** What `root` gets for the current page, from its entry and its meta args; not from `meta()`. */
  // oxlint-disable-next-line typescript/method-signature-style -- see above.
  state?(entry: TableEntry, args: MetaArgs): S;
  /**
   * Wraps the router's children. It passes `state` down, such as in a
   * context, and never reads it itself: the read waits for the page's data,
   * and only a `<Loading>` below can hold it.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- see above.
  root?(
    state: Accessor<S | undefined>,
    children: () => JSX.Element
  ): JSX.Element;
  /** `paths` of `defineRoutes()`; with more than one, the last one's. */
  readonly paths?: () => object;
  /**
   * The language versions of an announced page, from the entry `announce`
   * gave: each path with its `hreflang`, `x-default` included, as the page's
   * head names them. None for a page in one language.
   */
  readonly alternates?: (
    entry: TableEntry,
    translations: LanguageParams
  ) => readonly LanguagePath[];
}

/** A page's params in each language it exists in, as `translations` gives them: `{ de: { slug: "a" } }`. */
export type LanguageParams = Readonly<
  Partial<Record<string, Readonly<Partial<Record<string, string>>> | null>>
>;

/** A page's path in one language, or `x-default`. */
export interface LanguagePath {
  hreflang: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Helpers for an extension's hooks. Only an extension that calls one
// bundles it.

/**
 * An entry's component that renders through `render`, for an extension's
 * `pages`. It keeps the fields Solid Router loads a lazy chunk through.
 */
export function wrapComponent(
  component: Component<RouteSectionProps>,
  render: (props: RouteSectionProps) => JSX.Element
): Component<RouteSectionProps> {
  // A plain function makes no owner, so the hydration ids stay as they were.
  function Wrapped(props: RouteSectionProps): JSX.Element {
    return render(props);
  }

  return Object.assign(Wrapped, {
    preload: "preload" in component ? component.preload : undefined,
    moduleUrl: "moduleUrl" in component ? component.moduleUrl : undefined,
  });
}

/** What an extension's `args` is. */
type ArgsOf = NonNullable<RouterExtension["args"]>;

/** The tree with the fields of `read`, the extension's `args`, in every entry's props and preload args. */
export function withArgs(
  pages: readonly TableEntry[],
  read: ArgsOf
): TableEntry[] {
  return pages.map((entry) => entryWithArgs(entry, read));
}

/** The entry with `read`'s fields in its props and its preload args; see `withArgs`. */
function entryWithArgs(entry: TableEntry, read: ArgsOf): TableEntry {
  const { component, preload } = entry;

  // One call: `args` gives the same keys at every location.
  // SAFETY: the keys of what `args` gives are keys of RouteArgsExtension.
  const keys = Object.keys(
    read(entry, { pathname: "/" })
  ) as (keyof RouteArgsExtension)[];

  return {
    ...entry,
    component: wrapComponent(component, (props) => {
      // The router's getters, copied as getters, so every prop stays live.
      const descriptors = Object.getOwnPropertyDescriptors(props);

      for (const key of keys) {
        descriptors[key] = {
          enumerable: true,
          get: () => read(entry, props.location)[key],
        };
      }

      // SAFETY: the router's props and the extensions' fields, as RouteSectionProps
      // with RouteArgsExtension says.
      return createComponent(
        component,
        Object.defineProperties({}, descriptors) as RouteSectionProps
      );
    }),
    preload:
      preload &&
      ((args: RoutePreloadFuncArgs) =>
        preload({ ...args, ...read(entry, args.location) })),
    children: entry.children?.map((child) => entryWithArgs(child, read)),
  };
}
