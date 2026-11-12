import type { Location } from "@solidjs/router";
import type { HeadTag, JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import type {
  HeadFields,
  RouteArgsExtension,
  RouterExtension,
  TableEntry,
} from "./extend.ts";
import type { MetaArgs } from "./meta.ts";

type Extensions = readonly RouterExtension[];

/** The fields every extension's `args` gives for an entry at `location`. */
export function extensionArgs(
  extensions: Extensions,
  entry: TableEntry,
  location: Pick<Location, "pathname">
): RouteArgsExtension {
  const out: Partial<RouteArgsExtension> = {};

  for (const extension of extensions) {
    Object.assign(out, extension.args?.(entry, location));
  }

  // SAFETY: each extension's `args` gives the fields its declaration merges
  // into RouteArgsExtension.
  return out as RouteArgsExtension;
}

/** The page tree after every extension's `pages`. */
export function extendPages(
  pages: readonly TableEntry[],
  extensions: Extensions
): readonly TableEntry[] {
  let out = pages;

  for (const extension of extensions) {
    out = extension.pages?.(out) ?? out;
  }

  return out;
}

/** The `paths` an extension gives, or undefined for Solid Router's. */
export function extensionPaths(extensions: Extensions): object | undefined {
  return extensions.findLast((extension) => extension.paths)?.paths?.();
}

/** What the extensions' `head` gave for a page, merged. */
export interface ExtensionHead {
  fields: HeadFields;
  tags: HeadTag[];
  always: HeadTag[];
  notFound: boolean;
  announce: string[];
}

export function extensionHead(
  extensions: Extensions,
  entry: TableEntry,
  args: MetaArgs
): ExtensionHead {
  const out: ExtensionHead = {
    fields: {},
    tags: [],
    always: [],
    notFound: false,
    announce: [],
  };

  for (const extension of extensions) {
    const added = extension.head?.(entry, args);
    Object.assign(out.fields, added?.meta);
    out.tags.push(...(added?.tags ?? []));
    out.always.push(...(added?.always ?? []));
    out.notFound ||= added?.notFound === true;
    out.announce.push(...(added?.announce ?? []));
  }

  return out;
}

/** Each extension's state for a page, by its index in the list. */
export function extensionStates(
  extensions: Extensions,
  entry: TableEntry,
  args: MetaArgs
): unknown[] {
  return extensions.map((extension) => extension.state?.(entry, args));
}

/**
 * The router's children inside each extension's `root`, the first
 * outermost. The children stay a function, so they are created inside the
 * providers a `root` sets up.
 */
export function extensionRoot(
  extensions: Extensions,
  states: Accessor<readonly unknown[] | undefined>,
  children: () => JSX.Element
): JSX.Element {
  let render = children;

  for (const [i, extension] of [...extensions.entries()].toReversed()) {
    if (!extension.root) {
      continue;
    }

    const inner = render;
    render = () => extension.root?.(() => states()?.[i], inner);
  }

  return render();
}
