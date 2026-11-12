import type {
  OutputMatch,
  Params,
  RoutePreloadFuncArgs,
  RouteSectionProps,
} from "@solidjs/router";
import type { Component } from "solid-js";

import type { TableEntry } from "./extend.ts";
import type { RouteMeta } from "./index.ts";

/** What the head and an outlet need from a `createRouter` instance: the tree and pure matching. */
export interface RouterLike {
  readonly routes: readonly unknown[];
  match: (url: string) => OutputMatch[];
}

/** One level of a matched chain: the table entry and the params of its match. */
export interface ChainLevel {
  readonly component: Component<RouteSectionProps>;
  readonly preload: ((args: RoutePreloadFuncArgs) => unknown) | undefined;
  /** The page's `meta`; undefined on a layout. */
  readonly meta: RouteMeta;
  readonly params: Params;
  /** The full pattern, `/docs/:slug`. */
  readonly pattern: string;
  /** The table entry itself, for the site's extensions. */
  readonly entry: TableEntry;
}

/**
 * Pairs `Router.match(url)` with the table entries it came from, layout
 * first, so a caller can render the chain itself with props pinned to that
 * URL. A match's `path` is the entry's path as written in the table, so the
 * walk follows `children` one level per match. Throws when a match has no
 * entry, which means `pages` is not the tree the router was created with.
 */
export function matchChain(
  pages: readonly unknown[],
  matches: readonly OutputMatch[]
): ChainLevel[] {
  const chain: ChainLevel[] = [];
  // SAFETY: `pages` is the tree the router was created with; an entry the
  // walk cannot find throws below.
  let level = pages as readonly TableEntry[];

  for (const match of matches) {
    const entry = level.find(
      (def) =>
        def.path === match.path &&
        (match.info === undefined || def.info === match.info)
    );

    if (!entry) {
      throw new Error(
        `[@visio/router] no table entry for the match "${match.pattern}". Pass the same pages the router was created with.`
      );
    }

    chain.push({
      component: entry.component,
      preload: entry.preload,
      meta: entry.meta,
      params: match.params,
      pattern: match.pattern,
      entry,
    });
    level = entry.children ?? [];
  }

  return chain;
}
