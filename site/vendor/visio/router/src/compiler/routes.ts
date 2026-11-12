import path from "node:path";

import { MagicString } from "magic-string";
import { parseSync } from "oxc-parser";

import { isDynamic, patternSource, relativeTo } from "../pattern.ts";
import {
  child,
  children,
  elements,
  exportedNames,
  isCall,
  isIdentifier,
  programBody,
  lineOf,
  specifierName,
  stringValue,
  walk,
} from "./ast.ts";
import type { AstNode, CallExpression } from "./ast.ts";

export const PACKAGE = "@visio/router";
const HELPERS = ["page", "layout", "index", "catchAll", "api"] as const;

type Helper = (typeof HELPERS)[number];

function isHelper(name: string): name is Helper {
  return HELPERS.some((helper) => helper === name);
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  file: string;
  line?: number;
  /** The npm name of the package whose check it is; the router's without one. */
  package?: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `[${d.code}] ${d.message}\n  at ${d.file}${d.line ? `:${d.line}` : ""}`;
}

/** What the rewriter needs to know about a page module. */
export interface ModuleFacts {
  /** The pattern passed to defineRoute()/defineLayout(), when the module has one. */
  pattern?: string;
  hasRoute: boolean;
  hasDefault: boolean;
  /** Which helper declared it: defineRoute has meta, defineLayout may not. */
  kind?: "route" | "layout";
  /** Declares match filters, or options the syntax does not show: may share a path with another route. */
  filtered?: boolean;
  /** The line of the `route` export, when there is one. */
  line?: number;
  /** The options argument of defineRoute()/defineLayout(), for the extensions' checks. */
  options?: AstNode;
}

/** A helper call in the routes file. */
export interface RouteSite {
  call: CallExpression;
  helper: Helper;
  path?: string;
  /** The `() => import('x')` argument and its source literal. */
  loader?: AstNode;
  source?: AstNode;
  specifier?: string;
  /** For index(): the enclosing layout's path. */
  parent?: string;
  /** The argument for the site's extensions, after the loader of page() and the children of layout(). */
  options?: AstNode;
}

/** A module a loader names, for the caller to resolve before the rewrite. */
export interface Loader {
  specifier: string;
  /** Whether the checks read its source: a page's yes, an api handler's no. */
  read: boolean;
}

/** A routes file as `collectRoutes()` reads it, before anything is resolved. */
export interface RouteTable {
  file: string;
  code: string;
  /** Helper calls in source order, a layout before its children. */
  sites: RouteSite[];
  /** Every module the table loads, once each. */
  loaders: Loader[];
  /** The options object of `defineRoutes()`, when it has one. */
  options?: AstNode | undefined;
  /** The file's top-level statements, for an extension that reads a `const`. */
  body: AstNode[];
}

/** What the build needs from the table besides the rewrite. */
export interface RouteFacts {
  /** The full patterns of the pages a cache may keep: not `live`, not the catch-all. */
  cached: string[];
  /** The full patterns that answer per request: the `live` pages and the `api()` routes. */
  uncached: string[];
  /** The full patterns of the `api()` routes. */
  api: string[];
  /** The paths and patterns of `pending`: pages linked to but not built yet. */
  pending: string[];
}

/** A page module a site loads, as the checks read it. */
export interface SiteModule {
  /** The resolved file. */
  file: string;
  facts: ModuleFacts;
}

/** What an extension's checks read: the table, each site's full path, and its module. */
export interface TableCheck {
  table: RouteTable;
  /** Each site's full path as the router matches it; undefined where it is not a literal. */
  full: ReadonlyMap<RouteSite, string | undefined>;
  /** The page module of each site whose source was read. */
  modules: ReadonlyMap<RouteSite, SiteModule>;
}

/**
 * What a package adds to the build's reading of the table (DESIGN.md,
 * Extensions). `visio()` passes the router part of each extension in its
 * `extensions` option.
 */
export interface RoutesExtension {
  /** The package's npm name: its diagnostics print with it. */
  readonly name: string;
  /**
   * More full patterns of a site, such as its paths in other languages:
   * the duplicate check and the route facts count them like the site's own.
   */
  readonly sitePaths?: (
    site: RouteSite,
    full: string,
    table: RouteTable
  ) => readonly string[];
  /** Checks of the table and its modules, after the router's own. */
  readonly diagnostics?: (check: TableCheck) => Diagnostic[];
}

/** The extensions' checks, each diagnostic with the name of the package it came from. */
function extensionDiagnostics(
  extensions: readonly RoutesExtension[],
  check: TableCheck
): Diagnostic[] {
  return extensions.flatMap((extension) =>
    (extension.diagnostics?.(check) ?? []).map((d) => ({
      ...d,
      package: extension.name,
    }))
  );
}

/** A site's full path and the ones the extensions add. */
function pathsOf(
  site: RouteSite,
  at: string,
  table: RouteTable,
  extensions: readonly RoutesExtension[]
): string[] {
  // An extension may give the site's own path again: it is one path.
  return [
    ...new Set([
      at,
      ...extensions.flatMap((e) => e.sitePaths?.(site, at, table) ?? []),
    ]),
  ];
}

/** A loader's module as the caller found it. */
export interface LoadedModule {
  /** The resolved file; absent when the specifier does not resolve. */
  id?: string | undefined;
  /** Its source, for the checks; absent when it was not read or could not be. */
  source?: string | undefined;
}

export interface RewriteOptions {
  /** `client` drops api() loaders. */
  environment: "client" | "server";
  /** The table's loaders by specifier, resolved and, where `read`, read. */
  modules: ReadonlyMap<string, LoadedModule>;
  extensions?: readonly RoutesExtension[];
}

export interface RewriteResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
  diagnostics: Diagnostic[];
  /** Files the routes file references, for the watcher. */
  modules: string[];
  changed: boolean;
}

/**
 * The query keeps the two variants distinct modules; `lang` keeps the
 * extension visible to other plugins.
 */
export function pickId(specifier: string, pick: "route" | "default"): string {
  const query = specifier.indexOf("?");
  const bare = query === -1 ? specifier : specifier.slice(0, query);
  const ext = path.extname(bare).slice(1) || "tsx";

  return `${specifier}?pick=${pick}&lang.${ext}`;
}

/** The package's imports in a module: local name to imported name. */
function packageImports(body: readonly AstNode[]): Map<string, string> {
  const locals = new Map<string, string>();

  for (const node of body) {
    if (
      node.type !== "ImportDeclaration" ||
      stringValue(child(node, "source")) !== PACKAGE
    ) {
      continue;
    }

    for (const s of children(node, "specifiers")) {
      const imported = specifierName(child(s, "imported"));
      const local = child(s, "local");

      if (imported && isIdentifier(local)) {
        locals.set(local.name, imported);
      }
    }
  }

  return locals;
}

/** Reads a module's route declaration without evaluating it. */
export function moduleFacts(code: string, file: string): ModuleFacts {
  const { program } = parseSync(file, code);
  const body = programBody(program);
  const facts: ModuleFacts = { hasRoute: false, hasDefault: false };
  const locals = packageImports(body);

  for (const node of body) {
    const names = exportedNames(node);

    if (names.includes("route")) {
      facts.hasRoute = true;
    }

    if (names.includes("default")) {
      facts.hasDefault = true;
    }

    const decl =
      node.type === "ExportNamedDeclaration"
        ? child(node, "declaration")
        : undefined;

    if (decl?.type !== "VariableDeclaration") {
      continue;
    }

    for (const d of children(decl, "declarations")) {
      const id = child(d, "id");

      if (!isIdentifier(id) || id.name !== "route") {
        continue;
      }

      facts.line = lineOf(code, d.start);
      const init = child(d, "init");

      if (!isCall(init) || !isIdentifier(init.callee)) {
        continue;
      }

      const helper = locals.get(init.callee.name);

      if (helper !== "defineRoute" && helper !== "defineLayout") {
        continue;
      }

      facts.kind = helper === "defineRoute" ? "route" : "layout";
      const [pattern, options] = init.arguments;
      facts.pattern = stringValue(pattern);

      if (options) {
        facts.options = options;
      }

      if (hasFilters(options)) {
        facts.filtered = true;
      }
    }
  }

  return facts;
}

/** Whether route options hold `matchFilters`, or could: anything but a plain object literal. */
function hasFilters(options: AstNode | undefined): boolean {
  if (!options) {
    return false;
  }

  if (options.type !== "ObjectExpression") {
    return true;
  }

  return children(options, "properties").some((prop) => {
    if (prop.type !== "Property") {
      return true;
    }

    const key = child(prop, "key");

    return (isIdentifier(key) ? key.name : stringValue(key)) === "matchFilters";
  });
}

function arrowImport(
  arg: AstNode | undefined
): { source: AstNode; specifier: string } | undefined {
  if (arg?.type !== "ArrowFunctionExpression") {
    return undefined;
  }

  let body = child(arg, "body");

  if (body?.type === "BlockStatement") {
    const [only, ...rest] = children(body, "body");

    if (only?.type !== "ReturnStatement" || rest.length > 0) {
      return undefined;
    }

    body = child(only, "argument");
  }

  if (body?.type !== "ImportExpression") {
    return undefined;
  }

  const source = child(body, "source");
  const specifier = stringValue(source);

  return source && specifier ? { source, specifier } : undefined;
}

/** Where the extensions' argument is: after the loader, or a layout's children. */
const OPTIONS_AT: Partial<Record<Helper, number>> = { page: 2, layout: 3 };

function siteOf(call: CallExpression, helper: Helper): RouteSite {
  const site: RouteSite = { call, helper };
  const bare = helper === "index" || helper === "catchAll";

  if (!bare) {
    site.path = stringValue(call.arguments[0]);
  }

  const at = OPTIONS_AT[helper];
  const options = at === undefined ? undefined : call.arguments[at];

  if (options) {
    site.options = options;
  }

  const loader = call.arguments[bare ? 0 : 1];
  const found = arrowImport(loader);

  if (found) {
    site.loader = loader;
    site.source = found.source;
    site.specifier = found.specifier;
  }

  return site;
}

export function contains(outer: AstNode, inner: AstNode): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * Reads the helper calls of a routes file and the modules their loaders
 * name, without resolving anything. Undefined when the file imports none
 * of the helpers. Only real `() => import('x')` arguments count, never an
 * `import()` in a comment or a string.
 */
export function collectRoutes(
  code: string,
  file: string
): RouteTable | undefined {
  const { program } = parseSync(file, code);
  const body = programBody(program);

  const locals = new Map<string, Helper>();

  for (const [local, imported] of packageImports(body)) {
    if (isHelper(imported)) {
      locals.set(local, imported);
    }
  }

  if (locals.size === 0) {
    return undefined;
  }

  const define = [...packageImports(body)].find(
    ([, imported]) => imported === "defineRoutes"
  )?.[0];

  let options: AstNode | undefined;
  const sites: RouteSite[] = [];
  walk(body, (node) => {
    if (!isCall(node) || !isIdentifier(node.callee)) {
      return;
    }

    if (node.callee.name === define) {
      [, options] = node.arguments;
    }

    const helper = locals.get(node.callee.name);

    if (helper) {
      sites.push(siteOf(node, helper));
    }
  });

  const loaders = new Map<string, boolean>();

  for (const site of sites) {
    // An index is the page at its innermost enclosing layout. Sites come in
    // source order, so that is the last layout before it whose call holds it.
    if (site.helper === "index") {
      const layout = sites.findLast(
        (s) =>
          s.helper === "layout" && s !== site && contains(s.call, site.call)
      );

      // A layout path that is not a literal is reported on the layout.
      if (layout?.path !== undefined) {
        site.parent = layout.path;
      }
    }

    if (site.specifier) {
      loaders.set(
        site.specifier,
        loaders.get(site.specifier) === true || site.helper !== "api"
      );
    }
  }

  return {
    file,
    code,
    sites,
    loaders: [...loaders].map(([specifier, read]) => ({ specifier, read })),
    options,
    body,
  };
}

/** The value of property `name` of an object literal. */
export function property(
  object: AstNode | undefined,
  name: string
): AstNode | undefined {
  if (object?.type !== "ObjectExpression") {
    return undefined;
  }

  for (const prop of children(object, "properties")) {
    if (prop.type !== "Property") {
      continue;
    }

    const key = child(prop, "key");

    if ((isIdentifier(key) && key.name === name) || stringValue(key) === name) {
      return child(prop, "value");
    }
  }

  return undefined;
}

function error(
  table: RouteTable,
  code: string,
  message: string,
  node: AstNode
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    file: table.file,
    line: lineOf(table.code, node.start),
  };
}

/** The `defineRoutes()` options the build cannot read. */
function optionsDiagnostics(
  table: RouteTable,
  live: AstNode | undefined
): Diagnostic[] {
  const { options } = table;
  const diagnostics: Diagnostic[] = [];

  // A list the build cannot read would put live pages in the cache.
  if (
    options &&
    (options.type !== "ObjectExpression" ||
      children(options, "properties").some((p) => p.type !== "Property"))
  ) {
    diagnostics.push(
      error(
        table,
        "OPTIONS_NOT_STATIC",
        "defineRoutes() needs its options as an object literal, e.g. { live: [page(...)], pending: [...] }, with no spread, so the build reads which pages are live.",
        options
      )
    );
  }

  if (live && live.type !== "ArrayExpression") {
    diagnostics.push(
      error(
        table,
        "LIVE_NOT_STATIC",
        "live needs an array literal of routes, e.g. live: [page(...)], so the build reads which pages it may not cache.",
        live
      )
    );
  }

  return diagnostics;
}

interface PendingCheck {
  pending: string[];
  diagnostics: Diagnostic[];
}

/** The pending paths, checked against the table's pages by their route key. */
function pendingDiagnostics(
  table: RouteTable,
  list: AstNode | undefined,
  pages: ReadonlyMap<string, string>
): PendingCheck {
  const pending: string[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!list) {
    return { pending, diagnostics };
  }

  const items = list.type === "ArrayExpression" ? elements(list) : [];

  const entries = items.map((item) => {
    const entry = stringValue(item);

    return item && entry?.startsWith("/") ? { item, entry } : undefined;
  });

  if (list.type !== "ArrayExpression" || entries.includes(undefined)) {
    diagnostics.push(
      error(
        table,
        "PENDING_NOT_STATIC",
        "pending needs an array of literal paths, e.g. pending: ['/about', '/work/:slug'], so the build reads it without running the table.",
        list
      )
    );

    return { pending, diagnostics };
  }

  for (const found of entries) {
    if (!found) {
      continue;
    }

    const { item, entry } = found;
    pending.push(entry);
    const match = new RegExp(patternSource(entry), "u");

    // A page the pattern takes in would never be crawled.
    const page =
      pages.get(routeKey(entry)) ??
      [...pages.values()].find((at) => !isDynamic(at) && match.test(at));

    if (page) {
      diagnostics.push(
        error(
          table,
          "PENDING_HAS_PAGE",
          `${entry} is in pending, but the table has a page it takes in (${page}), which the crawl would skip. Remove it from pending, or narrow it so the page is left out.`,
          item
        )
      );
    } else {
      diagnostics.push({
        code: "ROUTE_PENDING",
        severity: "warning",
        message: `${entry} is pending: the crawl skips links to it, and it answers with the 404 page until its page is in the table.`,
        file: table.file,
        line: lineOf(table.code, item.start),
      });
    }
  }

  return { pending, diagnostics };
}

export function routeFacts(
  table: RouteTable,
  extensions: readonly RoutesExtension[] = []
) {
  const live = property(table.options, "live");
  const diagnostics = optionsDiagnostics(table, live);

  const full = fullPaths(table.sites);
  const cached = new Set<string>();
  const uncached = new Set<string>();
  const api = new Set<string>();
  const pages = new Map<string, string>();

  for (const site of table.sites) {
    const at = full.get(site);

    if (at === undefined) {
      continue;
    }

    const isLive = live !== undefined && contains(live, site.call);

    for (const one of pathsOf(site, at, table, extensions)) {
      if (site.helper === "api" || (isLive && site.helper !== "layout")) {
        uncached.add(one);
      }

      if (site.helper === "api") {
        api.add(one);
      }

      if (site.helper !== "page" && site.helper !== "index") {
        continue;
      }

      pages.set(routeKey(one), one);

      if (!isLive) {
        cached.add(one);
      }
    }
  }

  const pending = pendingDiagnostics(
    table,
    property(table.options, "pending"),
    pages
  );

  diagnostics.push(...pending.diagnostics);

  const facts: RouteFacts = {
    cached: [...cached],
    uncached: [...uncached],
    api: [...api],
    pending: pending.pending,
  };

  return { facts, diagnostics };
}

/**
 * A path as the duplicate check sees it: `/a/:x` and `/a/:y` are the same
 * route, and so are `/a/:x?` and `/a/:x`.
 */
function routeKey(pattern: string): string {
  return pattern.replaceAll(/(?<sigil>[:*])[^\/]*/gv, "$<sigil>");
}

/** A child's path, relative to its layout's, as a full path. */
function joinPath(base: string, rel: string): string {
  if (rel === "/") {
    return base || "/";
  }

  const tail = rel.startsWith("/") ? rel : `/${rel}`;

  return base === "/" ? tail : `${base}${tail}`;
}

/** The path a site's own call gives it, before its layouts. */
function ownPath(site: RouteSite): string | undefined {
  if (site.helper === "index") {
    return "/";
  }

  if (site.helper === "catchAll") {
    return "*404";
  }

  return site.path;
}

/** A child's own path, relative to its layout's path `at`. */
/**
 * Every site's full path as the router matches it, built the way `layout()`
 * nests its children; undefined under a layout without a literal path.
 */
function fullPaths(sites: RouteSite[]): Map<RouteSite, string | undefined> {
  const out = new Map<RouteSite, string | undefined>();

  // Sites come in source order, so a layout is resolved before its children.
  for (const site of sites) {
    const own = ownPath(site);

    const layout = sites.findLast(
      (s) => s.helper === "layout" && s !== site && contains(s.call, site.call)
    );

    if (own === undefined) {
      out.set(site, undefined);
      continue;
    }

    if (!layout) {
      out.set(site, joinPath("", own));
      continue;
    }

    const at = layout.path;
    const base = out.get(layout);

    if (at === undefined || !base) {
      out.set(site, undefined);
      continue;
    }

    out.set(site, joinPath(base, relativeTo(at, own)));
  }

  return out;
}

/**
 * Two routes at one path: the second never matches. Param names do not
 * count, a route with match filters is left out, and API routes are
 * checked among themselves. Layouts only prefix their children.
 */
function duplicates(
  table: RouteTable,
  checked: ReadonlyMap<RouteSite, boolean>,
  extensions: readonly RoutesExtension[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const full = fullPaths(table.sites);
  const seen = new Map<string, RouteSite>();

  for (const [site, filtered] of checked) {
    const own = full.get(site);

    if (site.helper === "layout" || filtered || own === undefined) {
      continue;
    }

    for (const at of pathsOf(site, own, table, extensions)) {
      const key = `${site.helper === "api" ? "api" : "page"} ${routeKey(at)}`;
      const first = seen.get(key);

      if (!first) {
        seen.set(key, site);
        continue;
      }

      diagnostics.push({
        code: "ROUTE_DUPLICATE",
        severity: "error",
        message: `${site.helper}() resolves to "${at}", like ${first.helper}() at line ${lineOf(table.code, first.call.start)}; the second never matches. Give one a different path (param names do not count), or tell them apart with matchFilters.`,
        file: table.file,
        line: lineOf(table.code, site.call.start),
      });
    }
  }

  return diagnostics;
}

/** A site whose loader is a literal `() => import('x')`. */
type LoadedSite = RouteSite & {
  loader: AstNode;
  source: AstNode;
  specifier: string;
};

function isLoaded(site: RouteSite): site is LoadedSite {
  return (
    site.loader !== undefined &&
    site.source !== undefined &&
    site.specifier !== undefined
  );
}

/** Why a site cannot be rewritten: its loader or its path is not a literal. */
function staticDiagnostic(
  table: RouteTable,
  site: RouteSite
): Diagnostic | undefined {
  const { call, helper } = site;
  const bare = helper === "index" || helper === "catchAll";

  if (!isLoaded(site)) {
    const arg = bare ? "first" : "second";

    return error(
      table,
      "LOADER_NOT_STATIC",
      `${helper}() needs \`() => import('./pages/x')\` as its ${arg} argument, an arrow returning a dynamic import with a literal path, so the module can be split into its route and its component.`,
      call
    );
  }

  if (!bare && site.path === undefined) {
    return error(
      table,
      "PATH_NOT_STATIC",
      `${helper}() needs a literal path as its first argument, e.g. ${helper}('/about', ...).`,
      call
    );
  }

  return undefined;
}

/** The pattern the table expects a site's module to declare. */
function expectedPattern(site: RouteSite): string | undefined {
  if (site.helper === "index") {
    return site.parent;
  }

  if (site.helper === "catchAll") {
    return "*404";
  }

  return site.path;
}

/** Where a module disagrees with the site that loads it. */
function moduleDiagnostics(
  table: RouteTable,
  site: RouteSite,
  facts: ModuleFacts,
  rel: string
): Diagnostic[] {
  const { call, helper } = site;
  const diagnostics: Diagnostic[] = [];

  if (!facts.hasDefault) {
    diagnostics.push(
      error(
        table,
        "MODULE_NEEDS_DEFAULT",
        `${rel} has no default export. ${helper}() needs the page component as the default export.`,
        call
      )
    );
  }

  const needsRoute =
    helper === "page" || helper === "index" || helper === "catchAll";

  if (needsRoute && !facts.hasRoute) {
    diagnostics.push(
      error(
        table,
        "MODULE_NEEDS_ROUTE",
        `${rel} does not export \`route\`. Add \`export const route = defineRoute('${site.path ?? site.parent ?? "*404"}', { meta: () => ({ title: '...' }) })\`.`,
        call
      )
    );
  } else if (needsRoute && facts.kind === "layout") {
    diagnostics.push(
      error(
        table,
        "PAGE_NEEDS_DEFINE_ROUTE",
        `${rel} declares its route with defineLayout(). A page uses defineRoute(), which requires meta.`,
        call
      )
    );
  }

  const expected = expectedPattern(site);

  if (
    facts.pattern !== undefined &&
    expected !== undefined &&
    facts.pattern !== expected
  ) {
    const where =
      helper === "index"
        ? `index() under layout('${site.parent}')`
        : `${helper}('${expected}')`;

    diagnostics.push(
      error(
        table,
        "PATTERN_MISMATCH",
        `${where} loads ${rel}, which declares '${facts.pattern}'. Make them the same; the module's pattern types its params, the table's pattern is the URL.`,
        call
      )
    );
  }

  return diagnostics;
}

/** The catch-all sits at the top of the table, once. */
function catchAllDiagnostics(table: RouteTable): Diagnostic[] {
  const { sites } = table;
  const diagnostics: Diagnostic[] = [];

  for (const site of sites) {
    if (
      site.helper === "catchAll" &&
      sites.some(
        (other) => other.helper === "layout" && contains(other.call, site.call)
      )
    ) {
      diagnostics.push(
        error(
          table,
          "CATCH_ALL_NESTED",
          `catchAll() sits inside a layout. The table has one catch-all, at the top: it answers every URL no route matches with a 404. Move it out of the layout.`,
          site.call
        )
      );
    }
  }

  if (!sites.some((site) => site.helper === "catchAll")) {
    diagnostics.push({
      code: "CATCH_ALL_MISSING",
      severity: "warning",
      message: `No catchAll() route. Unknown URLs will render nothing; add catchAll(() => import('./pages/not-found')).`,
      file: table.file,
    });
  }

  return diagnostics;
}

/**
 * Checks the table against its modules and rewrites it. `modules` holds
 * what the caller resolved and read for `table.loaders`; a specifier
 * without an id is reported as unresolvable.
 */
export function rewriteRoutes(
  table: RouteTable,
  opts: RewriteOptions
): RewriteResult {
  const { code, file, sites } = table;
  const diagnostics: Diagnostic[] = [];
  const modules: string[] = [];
  const s = new MagicString(code);
  const hoisted: string[] = [];
  // The sites that reach the table, for the duplicate check, with whether
  // their module declares match filters.
  const checked = new Map<RouteSite, boolean>();
  const read = new Map<RouteSite, SiteModule>();
  const extensions = opts.extensions ?? [];

  for (const site of sites) {
    const problem = staticDiagnostic(table, site);

    if (problem) {
      diagnostics.push(problem);
      continue;
    }

    if (!isLoaded(site)) {
      throw new Error(
        "staticDiagnostic() reports every site without a loader."
      );
    }

    const { call, helper } = site;

    const loaded = opts.modules.get(site.specifier);

    if (helper === "api") {
      // No server in the client bundle: drop the loader argument, and with it the chunk.
      if (opts.environment === "client") {
        const [pathArg] = call.arguments;

        if (!pathArg) {
          throw new Error("api() has a literal path, so a first argument.");
        }

        s.remove(pathArg.end, site.loader.end);
      }

      if (loaded?.id) {
        modules.push(loaded.id);
      }

      checked.set(site, false);
      continue;
    }

    if (!loaded?.id) {
      diagnostics.push(
        error(
          table,
          "MODULE_UNRESOLVED",
          `${helper}() cannot resolve '${site.specifier}'. Check the path; it is relative to this file.`,
          call
        )
      );
      continue;
    }

    modules.push(loaded.id);
    checked.set(site, false);

    if (loaded.source !== undefined) {
      const facts = moduleFacts(loaded.source, loaded.id);
      checked.set(site, facts.filtered === true);
      read.set(site, { file: loaded.id, facts });
      const rel = path.relative(path.dirname(file), loaded.id);
      diagnostics.push(...moduleDiagnostics(table, site, facts, rel));
    }

    const name = `__visio_route_${hoisted.length}`;
    hoisted.push(
      `import * as ${name} from ${JSON.stringify(pickId(site.specifier, "route"))};`
    );
    s.overwrite(
      site.source.start,
      site.source.end,
      JSON.stringify(pickId(site.specifier, "default"))
    );
    const last = call.arguments.at(-1);

    if (!last) {
      throw new Error(`${helper}() has a loader, so an argument.`);
    }

    s.appendLeft(last.end, `, ${name}.route`);
  }

  diagnostics.push(
    ...duplicates(table, checked, extensions),
    ...catchAllDiagnostics(table),
    ...extensionDiagnostics(extensions, {
      table,
      full: fullPaths(sites),
      modules: read,
    })
  );

  if (hoisted.length) {
    s.prepend(`${hoisted.join("\n")}\n`);
  }

  const changed = hoisted.length > 0 || s.hasChanged();

  return {
    code: changed ? s.toString() : code,
    map: changed
      ? s.generateMap({ hires: true, source: file, includeContent: false })
      : null,
    diagnostics,
    modules,
    changed,
  };
}

/**
 * The folder the page modules live in: the deepest one that holds every
 * module the table loads for a page, layout, index or catch-all. Undefined
 * when there is none inside `root`, since the project root itself is too
 * wide to scan.
 */
export function pagesDir(
  table: RouteTable,
  modules: ReadonlyMap<string, LoadedModule>,
  root: string
): string | undefined {
  let parts: string[] | undefined;

  for (const site of table.sites) {
    if (site.helper === "api" || !site.specifier) {
      continue;
    }

    const id = modules.get(site.specifier)?.id;

    if (!id) {
      continue;
    }

    const dir = path.dirname(id).split(path.sep);

    if (parts) {
      let i = 0;

      while (i < parts.length && i < dir.length && parts[i] === dir[i]) {
        i += 1;
      }

      parts = parts.slice(0, i);
    } else {
      parts = dir;
    }
  }

  if (!parts) {
    return undefined;
  }

  const dir = parts.join(path.sep);
  const rel = path.relative(root, dir);

  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? dir
    : undefined;
}

/** The table entry that would load an unused module. */
function suggestedCall(facts: ModuleFacts, load: string): string {
  if (facts.kind === "layout") {
    return `layout('${facts.pattern ?? "/x"}', ${load}, [...])`;
  }

  if (facts.pattern === "*404") {
    return `catchAll(${load})`;
  }

  return `page('${facts.pattern ?? "/x"}', ${load})`;
}

/**
 * Page modules no route loads: a file that declares its route with
 * defineRoute() or defineLayout() and is not one of `referenced`.
 * `candidates` are the files of the pages folder with their source.
 */
export function unusedPages(
  table: RouteTable,
  referenced: ReadonlySet<string>,
  candidates: readonly { id: string; source: string }[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { id, source } of candidates) {
    if (referenced.has(id) || !/\bdefine(?:Route|Layout)\b/v.test(source)) {
      continue;
    }

    let facts: ModuleFacts;

    try {
      facts = moduleFacts(source, id);
    } catch {
      continue;
    }

    if (!facts.kind) {
      continue;
    }

    const rel = path
      .relative(path.dirname(table.file), id)
      .replaceAll(path.sep, "/");

    const load =
      `() => import('${rel.startsWith(".") ? rel : `./${rel}`}')`.replace(
        /\.[cm]?[jt]sx?'\)$/v,
        "')"
      );

    const diagnostic: Diagnostic = {
      code: "ROUTE_UNUSED",
      severity: "warning",
      message: `${path.basename(id)} declares a route, but no route in ${path.basename(table.file)} loads it, so it never renders. Add ${suggestedCall(facts, load)} to the table, or delete the file.`,
      file: id,
    };

    if (facts.line) {
      diagnostic.line = facts.line;
    }

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}
