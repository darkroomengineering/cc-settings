import { createRouter, intentPreload, useLocation } from "@solidjs/router";
import type {
  MatchFilters,
  RouteDefinition,
  RouteParams,
  RoutePreloadFuncArgs,
  RouterInstance,
  RouteSectionProps,
} from "@solidjs/router";
import { httpHeader, isDev, isServer, useHead } from "@solidjs/web";
import type { JSX, RequestEvent } from "@solidjs/web";
import { createComponent, createEffect } from "solid-js";
import type { Component } from "solid-js";

import { announceRoutes } from "./announce.ts";
import { registerAnnouncers } from "./crawl.ts";
import type { Announcer } from "./crawl.ts";
import type {
  AnnounceFactsExtension,
  EntryOptions,
  PathsExtension,
  RouteArgsExtension,
  RouteOptionsExtension,
  RouterExtension,
  TableEntry,
} from "./extend.ts";
import {
  extendPages,
  extensionArgs,
  extensionPaths,
  extensionRoot,
} from "./extensions.ts";
import { markCommit } from "./late-read.ts";
import { iconTags, useRouteHead } from "./meta.ts";
import type { Meta, MetaArgs } from "./meta.ts";
import * as table from "./table.ts";

export type { Meta, MetaArgs, MetaImage, MetaTag, Settled } from "./meta.ts";

export { absoluteUrl } from "./meta.ts";

export { purgeCache, tagCache } from "./cache.ts";

export { query } from "./late-read.ts";

export {
  formAction,
  liveQuery,
  revalidate,
  useBeforeLeave,
  useHref,
  useIsRouting,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  usePreloadRoute,
  useResolvedPath,
  useRouteMatches,
  useSearchParams,
  useSubmissions,
} from "@solidjs/router";

export type {
  BeforeLeaveEventArgs,
  CachedFunction,
  FormAction,
  Location,
  NavigateOptions,
  Params,
  SearchParams,
  Submission,
} from "@solidjs/router";

// ---------------------------------------------------------------------------
// Page modules

/** What a preload receives: Solid Router's args and the fields of the site's extensions. */
export type PreloadArgs<P extends string = string> = RoutePreloadFuncArgs<
  RouteParams<P>
> &
  RouteArgsExtension;

export interface LayoutRoute<P extends string = string, T = unknown> {
  readonly path: P;
  readonly preload?: ((args: PreloadArgs<P>) => T) | undefined;
  readonly matchFilters?: MatchFilters<P> | undefined;
}

/**
 * What an entry of `announce` may give besides its params: the page's head
 * as `meta()` makes it, from the query that lists the pages. The live
 * sitemap and `llms.txt` read them; the crawl checks each against the page.
 */
export interface AnnounceFacts<
  P extends string = string,
> extends AnnounceFactsExtension<P> {
  modified?: string | undefined;
  noindex?: boolean | undefined;
  title?: string | undefined;
  description?: string | undefined;
}

/** Solid Router's params end in a string index signature, which would reject every fact that is not a string. */
type PatternKeys<P extends string> = {
  [
    K in keyof RouteParams<P> as string extends K ? never : K
  ]: RouteParams<P>[K];
};

/** One page of a dynamic route, as `announce` gives it. */
export type AnnouncedPage<P extends string = string> = PatternKeys<P> &
  AnnounceFacts<P>;

export interface PageRoute<P extends string = string, T = unknown>
  extends LayoutRoute<P, T>, RouteOptionsExtension<P, T> {
  readonly meta: (args: MetaArgs<P, T>) => Meta;
  /** The params of every page of a dynamic route, for the crawl: pages nothing links to are rendered and listed too. */
  readonly announce?:
    | ((
        args: RouteArgsExtension
      ) => readonly AnnouncedPage<P>[] | Promise<readonly AnnouncedPage<P>[]>)
    | undefined;
}

/** Any route, whatever its pattern; the constraint the tree helpers use. */
export interface AnyRoute {
  readonly path: string;
  readonly preload?: ((args: any) => any) | undefined;
  readonly meta?: ((args: any) => Meta) | undefined;
  readonly matchFilters?: unknown;
}

type DefineRouteOptions<P extends string, T> = Omit<PageRoute<P, T>, "path">;

type DefineLayoutOptions<P extends string, T> = Omit<LayoutRoute<P, T>, "path">;

/** A page's pattern, preload and head tags; export it as `route` (router skill). */
export function defineRoute<const P extends string, T = void>(
  path: P,
  options: DefineRouteOptions<P, T>
): PageRoute<P, T> {
  return { path, ...options };
}

/** Like `defineRoute` for a layout module, which has no meta: its pages set the head. */
export function defineLayout<const P extends string, T = void>(
  path: P,
  options: DefineLayoutOptions<P, T> = {}
): LayoutRoute<P, T> {
  return { path, ...options };
}

// `preload` is optional on every route, so the pattern matches it optional
// too; a required key would never match and `props.data` would be `unknown`.
type DataOf<R> = R extends {
  preload?: ((...args: any[]) => infer T) | undefined;
}
  ? T
  : unknown;

/**
 * A module's preload as Solid Router accepts it: typed params are a
 * property of the page module; the router itself sees the plain contract.
 */
type WidenedPreload<R> =
  | ((args: RoutePreloadFuncArgs) => DataOf<R>)
  | undefined;

/** A page's `meta` as the outlet reads it; undefined on a layout, or without the plugin. */
export type RouteMeta = ((args: MetaArgs) => Meta) | undefined;

/** Props of a page component, typed from its `route`. */
export type PageProps<R extends AnyRoute> = RouteSectionProps<
  DataOf<R>,
  RouteParams<R["path"]>
> &
  RouteArgsExtension;

/** Props of a layout component; `children` is the matched child. */
export type LayoutProps<R extends AnyRoute = AnyRoute> = PageProps<R>;

export interface PageModule<P extends string = string> {
  default: Component<any>;
  route: PageRoute<P, any>;
}

export interface LayoutModule<P extends string = string> {
  default: Component<any>;
  route?: LayoutRoute<P, any>;
}

// ---------------------------------------------------------------------------
// Route definitions

declare const PATTERN: unique symbol;
declare const API: unique symbol;

/** A page in the table, typed with its pattern and its module's route. */
export interface PageDef<
  P extends string = string,
  R extends AnyRoute = AnyRoute,
  O = unknown,
> {
  readonly path: P;
  readonly component: Component<any>;
  readonly preload: WidenedPreload<R>;
  readonly meta: RouteMeta;
  readonly matchFilters: R["matchFilters"];
  /** The last argument of `page()`, for the site's extensions. */
  readonly options: O;
}

export interface LayoutDef<
  P extends string = string,
  R extends AnyRoute = AnyRoute,
  C extends readonly unknown[] = readonly unknown[],
  O = unknown,
> {
  readonly path: P;
  readonly component: Component<any>;
  readonly preload: WidenedPreload<R>;
  readonly matchFilters: R["matchFilters"];
  readonly children: C;
  /** The last argument of `layout()`, for the site's extensions. */
  readonly options: O;
}

/** An index child: matched at the layout's own path. `Q` is the module's declared pattern. */
export interface IndexDef<
  Q extends string = string,
  R extends AnyRoute = AnyRoute,
> {
  readonly path: "/";
  readonly component: Component<any>;
  readonly preload: WidenedPreload<R>;
  readonly meta: RouteMeta;
  readonly matchFilters: R["matchFilters"];
  readonly [PATTERN]?: Q;
}

export interface CatchAllDef<R extends AnyRoute = AnyRoute> {
  readonly path: "*404";
  readonly component: Component<any>;
  readonly preload: WidenedPreload<R>;
  readonly meta: RouteMeta;
}

export type ApiHandler = (event: {
  request: Request;
  params: Record<string, string>;
}) => unknown;

/** One function of the chain. It runs in the request scope; call `next()` for the rest of the chain. */
export type Middleware = (
  event: RequestEvent,
  next: () => Promise<Response>
) => Response | Promise<Response>;

/** The default export of `src/middleware.ts`: the site's functions, in the order they run. */
export function defineMiddleware(
  chain: readonly Middleware[]
): readonly Middleware[] {
  return chain;
}

export type ApiModule = Partial<Record<HttpMethod, ApiHandler>>;

export type HttpMethod =
  | "HEAD"
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS";

export interface ApiDef<P extends string = string> {
  readonly path: P;
  /** Absent in the client build; the plugin strips it. */
  readonly load: (() => Promise<ApiModule>) | undefined;
  readonly [API]: true;
}

/** What may sit under a layout at `P`: pages and layouts below it, and its index. The catch-all is the table's own. */
type Under<P extends string> = P extends "/" ? `/${string}` : `${P}/${string}`;

export type Child<P extends string> =
  | PageDef<Under<P>, AnyRoute>
  | LayoutDef<Under<P>, AnyRoute, readonly unknown[]>
  | IndexDef<P, AnyRoute>;

/**
 * Rewrites children paths relative to the layout, the shape nested routers
 * expect. Under a root layout they are relative already.
 */
type Relative<P extends string, CP extends string> = P extends "/"
  ? CP
  : CP extends `${P}${infer Rest}`
    ? Rest extends ""
      ? "/"
      : Rest
    : CP;

export type RelativeChildren<P extends string, C extends readonly unknown[]> = {
  readonly [K in keyof C]: C[K] extends {
    readonly path: infer CP extends string;
  }
    ? Omit<C[K], "path"> & { readonly path: Relative<P, CP> }
    : C[K];
};

// ---------------------------------------------------------------------------
// Building the tree

/**
 * A page at `path`. The module's `route` must declare the same pattern.
 * `options` is for the site's extensions; without one, there is none.
 */
export const page: {
  <const P extends string, M extends PageModule<P>>(
    path: P,
    load: () => Promise<M>
  ): PageDef<P, M["route"], never>;
  // Its own overload: an optional O would be inferred from the list
  // defineRoutes() takes, as all of EntryOptions.
  <
    const P extends string,
    M extends PageModule<P>,
    const O extends EntryOptions,
  >(
    path: P,
    load: () => Promise<M>,
    options: O
  ): PageDef<P, M["route"], O>;
} = table.page;

/**
 * A layout at `path` wrapping `children`. Children are written with their
 * full patterns and nested relative to the layout; an `index()` child is
 * matched at the layout's own path.
 */
export const layout: {
  <
    const P extends string,
    M extends LayoutModule<P>,
    const C extends readonly Child<P>[],
  >(
    path: P,
    load: () => Promise<M>,
    children: C
  ): LayoutDef<P, NonNullable<M["route"]>, RelativeChildren<P, C>, never>;
  <
    const P extends string,
    M extends LayoutModule<P>,
    const C extends readonly Child<P>[],
    const O extends EntryOptions,
  >(
    path: P,
    load: () => Promise<M>,
    children: C,
    options: O
  ): LayoutDef<P, NonNullable<M["route"]>, RelativeChildren<P, C>, O>;
} = table.layout;

/** The page rendered at a layout's own path. Its `route` declares the layout's pattern. */
export const index: <M extends PageModule<any>>(
  load: () => Promise<M>
) => IndexDef<M["route"]["path"], M["route"]> = table.index;

/**
 * The route for everything else. Its `route` declares `'*404'`. It answers
 * with status 404 and `noindex`.
 */
export const catchAll: <M extends PageModule<"*404">>(
  load: () => Promise<M>
) => CatchAllDef<M["route"]> = table.catchAll;

/**
 * A request handler module at `path`: uppercase `GET`, `POST`, ... exports
 * answer requests, dispatched by the middleware chain `visio()` builds.
 * Needs a running server; the client build drops the loader.
 */
export function api<const P extends string>(
  path: P,
  load: () => Promise<ApiModule>
): ApiDef<P> {
  // SAFETY: the API brand is a type only; isApi() tells the entries apart.
  return { path, load } as ApiDef<P>;
}

type Entry =
  | PageDef<string, AnyRoute>
  | LayoutDef<string, AnyRoute, readonly unknown[]>
  | CatchAllDef<AnyRoute>
  | ApiDef<string>;

// Tail-recursive: TS stops a recursion that builds `[H, ...Pages<T>]` at
// about 50 entries (TS2589), and a route table can be longer.
type Pages<
  L extends readonly unknown[],
  Acc extends readonly unknown[] = readonly [],
> = L extends readonly [infer H, ...infer T]
  ? Pages<T, H extends ApiDef<string> ? Acc : readonly [...Acc, H]>
  : Acc;

type RouterOf<P> = RouterInstance<
  P extends readonly RouteDefinition[] ? P : never
>;

/** Solid Router's typed `paths`, or the one an extension gives. */
type PathsOf<P extends readonly unknown[]> =
  PathsExtension<P> extends { paths: infer X } ? X : RouterOf<P>["paths"];

export interface Routes<L extends readonly Entry[]> {
  /** The page tree the router matches. */
  readonly pages: Pages<L>;
  /** The API routes, which `visio()` serves in its middleware chain. */
  readonly api: readonly ApiDef[];
  /** The `pending` paths and patterns, for the smoke run; the build reads them from the source. */
  readonly pending: readonly string[];
  /** The router: the app renders it, it renders the page's head, `<PageTransitions>` matches against it, `visio()` hands it to the server. */
  readonly Router: RouterOf<Pages<L>>;
  /** Typed URL builder: `paths()` is `/`, `paths.docs(slug)` a page with a param. */
  readonly paths: PathsOf<Pages<L>>;
}

function isApi(entry: Entry): entry is ApiDef {
  return "load" in entry && !("component" in entry);
}

export interface RoutesOptions<V extends readonly Entry[]> {
  /**
   * Routes that need a live server: session pages, per-request data, API
   * routes. Their pages are marked `private, no-store`, so no cache holds them.
   */
  live?: V;
  /** Paths or patterns linked to before their pages are built; the crawl skips them. */
  pending?: readonly string[];
  /**
   * What optional packages add to the router, such as the languages of
   * `@visio/i18n`: each package's call gives its extension.
   */
  extensions?: readonly RouterExtension[];
}

/**
 * A live page whose server render marks the response private. The preload
 * runs before the shell flushes, so the header is still writable, and it
 * runs for a layout's children too.
 */
function uncached<E extends Entry>(entry: E): E {
  const plain: Entry = entry;

  if (isApi(plain)) {
    return entry;
  }

  const { preload } = plain;

  return {
    ...entry,
    preload: (args: RoutePreloadFuncArgs) => {
      if (isServer) {
        httpHeader("cache-control", "private, no-store");
      }

      return preload?.(args);
    },
  };
}

type AnyRouter = RouterInstance<readonly RouteDefinition[]>;

interface RouteHeadProps {
  router: AnyRouter;
  extensions: readonly RouterExtension[];
  children: () => JSX.Element;
}

/** The head of the page, around the router's children; see `withHead`. */
function RouteHead(props: RouteHeadProps): JSX.Element {
  announceRoutes(props.router, props.extensions);
  const icons = iconTags();

  if (icons.length > 0) {
    useHead(icons);
  }

  const states = useRouteHead(props.router, props.extensions);

  // On both sides, though it only runs in the browser: created on one side
  // alone, it would shift the hydration ids after it.
  if (isDev) {
    const location = useLocation();
    createEffect(
      () => location.pathname,
      (path, prev) => {
        if (prev !== undefined && path !== prev) {
          markCommit(path);
        }
      }
    );
  }

  return extensionRoot(props.extensions, states, props.children);
}

/**
 * The router with the route head and the crawl's route announcement at its
 * root, next to the render-prop child, which the router mounts once. Any
 * outlet then gets both, `props.children` too (DESIGN.md, Meta).
 */
function withHead(
  router: AnyRouter,
  extensions: readonly RouterExtension[]
): AnyRouter {
  function Router(props: Parameters<AnyRouter>[0]): ReturnType<AnyRouter> {
    return router({
      get url() {
        return props.url;
      },
      children: (section) =>
        createComponent(RouteHead, {
          router,
          extensions,
          children: () =>
            props.children ? props.children(section) : section.children,
        }),
    });
  }

  // SAFETY: the properties below give Router every field of the instance it wraps.
  return Object.defineProperties(Router, {
    routes: { value: router.routes },
    config: { value: router.config },
    match: { value: router.match },
    keysFor: { value: router.keysFor },
    paths: { get: () => router.paths },
  }) as AnyRouter;
}

/** A child's full path from its layout's and its own; the inverse of `relativeTo`. */
function fullPath(at: string, path: string): string {
  if (at === "/" || path.startsWith(`${at}/`) || path === at) {
    return path;
  }

  return path === "/" ? at : `${at}${path}`;
}

/**
 * Every page of the tree whose route has `announce`, at its full path, with
 * the args of its extensions. The path, not `pattern`: an extension's copy of
 * an entry, such as a language's, keeps the pattern and moves the path.
 */
function announcersOf(
  pages: readonly TableEntry[],
  extensions: readonly RouterExtension[],
  at = "/"
): Announcer[] {
  return pages.flatMap((entry): Announcer[] => {
    const full = fullPath(at, entry.path);
    // SAFETY: the plugin puts the page module's route here, a PageRoute.
    const { announce } = (entry.route ?? {}) as Pick<PageRoute, "announce">;
    const children = announcersOf(entry.children ?? [], extensions, full);

    if (!entry.pattern || !announce) {
      return children;
    }

    const args = extensionArgs(extensions, entry, { pathname: full });
    const languages = extensions.find((e) => e.alternates)?.alternates;

    return [
      {
        pattern: full,
        // SAFETY: past the facts, an entry's keys are its pattern's params, all strings.
        params: async () =>
          (await announce(args)) as Awaited<ReturnType<Announcer["params"]>>,
        alternates:
          languages && ((translations) => languages(entry, translations)),
      },
      ...children,
    ];
  });
}

/**
 * Splits the list into the page tree and the API routes. `live` entries
 * join the list; see `RoutesOptions`. Two routes at one path are
 * reported by the Vite plugin, where the table is read (`ROUTE_DUPLICATE`).
 */
export function defineRoutes<
  const L extends readonly Entry[],
  const V extends readonly Entry[] = readonly [],
>(list: L, options: RoutesOptions<V> = {}): Routes<readonly [...L, ...V]> {
  const extensions = options.extensions ?? [];
  const all = [...list, ...(options.live ?? []).map(uncached)];

  const pages = extendPages(
    // SAFETY: a page entry of the table is a TableEntry; Entry types it
    // for the helpers' callers.
    all.filter((entry) => !isApi(entry)) as unknown as readonly TableEntry[],
    extensions
  );

  const apiRoutes = all.filter(isApi);

  const Router = withHead(
    createRouter({
      // SAFETY: the page entries are route definitions whose types carry
      // more than Solid Router's.
      routes: pages as unknown as readonly RouteDefinition[],
      preloadLinks: intentPreload(),
    }),
    extensions
  );

  const routes = {
    pages,
    api: apiRoutes,
    pending: options.pending ?? [],
    Router,
    paths: extensionPaths(extensions) ?? Router.paths,
  };

  registerAnnouncers(routes, announcersOf(pages, extensions));

  // SAFETY: `pages` holds the entries of L and V that are not api() routes,
  // in order, which is what Pages<> computes; an extension that changes the
  // tree types it with its own `paths`.
  return routes as unknown as Routes<readonly [...L, ...V]>;
}
