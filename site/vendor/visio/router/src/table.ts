import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { httpStatus, isDev, isServer } from "@solidjs/web";
import { lazy } from "solid-js";
import type { Component } from "solid-js";

import type { EntryOptions } from "./extend.ts";
import type {
  AnyRoute,
  CatchAllDef,
  Child,
  IndexDef,
  LayoutDef,
  LayoutModule,
  PageDef,
  PageModule,
  RelativeChildren,
  RouteMeta,
} from "./index.ts";
import { watchPreload } from "./late-read.ts";
import { isPlainObject, isThenable } from "./meta.ts";
import { relativeTo } from "./pattern.ts";

interface ModuleLike {
  default: Component<any>;
  route?: AnyRoute;
}

/**
 * The plugin's eager route, or a stand-in whose preload loads the module
 * first (no plugin: tests, tools). The stand-in has no match filters and no
 * meta, so without the plugin a page has no head tags.
 */
function routeOf(
  load: () => Promise<ModuleLike>,
  route: AnyRoute | undefined
): AnyRoute {
  if (route) {
    return route;
  }

  return {
    path: "",
    preload: async (args: RoutePreloadFuncArgs) => {
      const mod = await load();

      return mod.route?.preload && handledPreload(mod.route.preload)(args);
    },
  };
}

async function quiet(pending: PromiseLike<unknown>): Promise<void> {
  try {
    await pending;
  } catch {
    // The page sees the rejection through `data`.
  }
}

function handledPreload<A, R>(preload: (args: A) => R): (args: A) => R {
  return (args) => {
    const data = preload(args);

    for (const value of isPlainObject(data) ? Object.values(data) : [data]) {
      if (isThenable(value)) {
        quiet(value);
      }
    }

    return data;
  };
}

function fromModule(
  load: () => Promise<ModuleLike>,
  eager: AnyRoute | undefined
) {
  const route = routeOf(load, eager);

  return {
    component: lazy(load),
    preload:
      route.preload &&
      handledPreload(isDev ? watchPreload(route.preload) : route.preload),
    meta: route.meta,
    matchFilters: route.matchFilters,
    // Solid Router hands `info` back on each match, so matchChain() tells
    // apart two entries at one path that only their matchFilters separate.
    info: {},
    route: eager,
  };
}

/** What may follow the loader: the entry's options, then the module's route. */
type TrailingArg = AnyRoute | EntryOptions | undefined;

interface Trailing {
  options: EntryOptions | undefined;
  route: AnyRoute | undefined;
}

function isRoute(arg: TrailingArg): arg is AnyRoute {
  return arg !== undefined && "path" in arg && typeof arg.path === "string";
}

function isOptions(arg: TrailingArg): arg is EntryOptions {
  return arg !== undefined && !isRoute(arg);
}

/**
 * The arguments after the loader (and a layout's children): the entry's
 * options for the site's extensions, then the module's route, which the
 * plugin appends. Without the plugin there is no route. Options never have
 * a `path`, so a route is told apart by it.
 */
export function trailing(rest: readonly TrailingArg[]): Trailing {
  const [first, second] = rest;
  const options = isOptions(first) ? first : undefined;
  const route = rest.length > 1 ? second : first;

  return { options, route: isRoute(route) ? route : undefined };
}

export function page<const P extends string, M extends PageModule<P>>(
  path: P,
  load: () => Promise<M>,
  ...rest: readonly TrailingArg[]
): PageDef<P, M["route"], never> {
  const { options, route } = trailing(rest);

  // SAFETY: the fields come from M["route"], or from a stand-in that loads
  // it; the overloads of `page` in index.ts type the options.
  return {
    path,
    pattern: path,
    options,
    ...fromModule(load, route),
  } as unknown as PageDef<P, M["route"], never>;
}

export function layout<
  const P extends string,
  M extends LayoutModule<P>,
  const C extends readonly Child<P>[],
>(
  path: P,
  load: () => Promise<M>,
  children: C,
  ...rest: readonly TrailingArg[]
): LayoutDef<P, NonNullable<M["route"]>, RelativeChildren<P, C>, never> {
  const { options, route } = trailing(rest);

  const nested = children.map((child) => ({
    ...child,
    path: relativeTo(path, child.path),
  }));

  // SAFETY: `nested` rewrites each child's path the way RelativeChildren
  // does, and the other fields come from M["route"]; the overloads of
  // `layout` in index.ts type the options.
  return {
    path,
    pattern: path,
    options,
    ...fromModule(load, route),
    children: nested,
  } as unknown as LayoutDef<
    P,
    NonNullable<M["route"]>,
    RelativeChildren<P, C>,
    never
  >;
}

export function index<M extends PageModule<any>>(
  load: () => Promise<M>,
  route?: M["route"]
): IndexDef<M["route"]["path"], M["route"]> {
  // SAFETY: the fields come from M["route"], or from a stand-in that loads it.
  return { path: "/", ...fromModule(load, route) } as IndexDef<
    M["route"]["path"],
    M["route"]
  >;
}

export function catchAll<M extends PageModule<"*404">>(
  load: () => Promise<M>,
  route?: M["route"]
): CatchAllDef<M["route"]> {
  const { component, preload, meta: pageMeta } = fromModule(load, route);

  const meta: RouteMeta =
    pageMeta && ((args) => ({ ...pageMeta(args), noindex: true }));

  return {
    path: "*404",
    component,
    // In the preload, so the status is set before the response head flushes.
    preload: (args: RoutePreloadFuncArgs) => {
      if (isServer) {
        httpStatus(404);
      }

      return preload?.(args);
    },
    meta,
  };
}
