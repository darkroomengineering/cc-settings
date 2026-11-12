import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Plugin } from "vite";

import { lineOf } from "./compiler/ast.ts";
import { pickExports } from "./compiler/pick.ts";
import {
  collectRoutes,
  formatDiagnostic,
  PACKAGE,
  pagesDir,
  rewriteRoutes,
  routeFacts,
  unusedPages,
} from "./compiler/routes.ts";
import type {
  Diagnostic,
  LoadedModule,
  RouteFacts,
  RoutesExtension,
  RouteTable,
} from "./compiler/routes.ts";
import { prerenderPlugin } from "./prerender.ts";
import type { CrawlWiring } from "./prerender.ts";
import { robotsMiddleware } from "./robots.ts";

export type { CrawlWiring } from "./prerender.ts";

export type {
  Diagnostic,
  LoadedModule,
  RouteFacts,
  RouteSite,
  RouteTable,
  RoutesExtension,
  SiteModule,
  TableCheck,
} from "./compiler/routes.ts";

export {
  collectRoutes,
  contains,
  property,
  rewriteRoutes,
  routeFacts,
} from "./compiler/routes.ts";

export {
  child,
  children,
  isCall,
  isIdentifier,
  lineOf,
  stringValue,
} from "./compiler/ast.ts";

export type { AstNode } from "./compiler/ast.ts";

export { isDynamic, patternSource } from "./pattern.ts";

export { announcedList } from "./announce-check.ts";

export { matchPath } from "./api.ts";

export { sitemapEntries } from "./prerender.ts";

const ROUTES = "src/routes.ts";

const PICK_RE = /[?&]pick=(?<pick>route|default)(?:&|$)/u;
const PICK_NAME_RE = /\.[cm]?[jt]sx?\?pick=(?:route|default)&lang$/v;

// Vite's sanitizer without the Windows drive-letter handling.
// oxlint-disable-next-line no-control-regex
const INVALID_CHAR_RE = /[\u0000-\u001F\u007F<>*#"{}|^[\]`;?:&=+$,]/gu;

function sanitizeFileName(name: string): string {
  return name.replace(PICK_NAME_RE, "").replaceAll(INVALID_CHAR_RE, "_");
}

// The root is not known when Vite reads the filter, so the handler still
// compares the resolved path exactly.
const ROUTES_ID_RE = /(?:^|\/)src\/routes\.ts(?:\?|$)/u;

function prefixed(d: Diagnostic): string {
  return `[${d.package ?? PACKAGE}] ${formatDiagnostic(d)}`;
}

function throwIfErrors(diagnostics: Diagnostic[]) {
  const errors = diagnostics.filter((d) => d.severity === "error");

  if (errors.length) {
    throw new Error(errors.map(prefixed).join("\n\n"));
  }
}

/** A path an extension of `visio()` serves itself, and the npm name of that extension. */
export interface ReservedPath {
  path: string;
  by: string;
}

/** A route under a path an extension serves itself (the Studio, Sanity's routes) would never be reached. */
function reservedPaths(
  table: RouteTable,
  reserved: readonly ReservedPath[]
): Diagnostic[] {
  return table.sites.flatMap((site) => {
    const owner = reserved.find(
      ({ path: base }) =>
        site.path === base || site.path?.startsWith(`${base}/`) === true
    );

    if (!owner || site.path === undefined) {
      return [];
    }

    return [
      {
        code: "ROUTE_RESERVED",
        severity: "error" as const,
        message: `${site.path} is under ${owner.path}, which ${owner.by} serves itself (its call in \`extensions\` of vite.config.ts). Move the route, or move the path with that call's options.`,
        file: table.file,
        line: lineOf(table.code, site.call.start),
      },
    ];
  });
}

const SOURCE_RE = /\.[cm]?[jt]sx?$/v;

/** A file's text, or undefined when it cannot be read. */
async function readSource(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
}

/** The source files under `dir`, skipping declarations and dependencies. */
async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);

  return entries
    .filter(
      (e) => e.isFile() && SOURCE_RE.test(e.name) && !e.name.endsWith(".d.ts")
    )
    .map((e) => path.join(e.parentPath, e.name))
    .filter((file) => !file.split(path.sep).includes("node_modules"));
}

/** The files of the pages folder the table does not load, read, for `unusedPages()`. */
async function readUnreferenced(
  files: readonly string[],
  referenced: ReadonlySet<string>
) {
  const read = await Promise.all(
    files
      .values()
      .filter((id) => !referenced.has(id))
      .map(async (id) => ({
        id,
        source: await readSource(id),
      }))
  );

  return read.filter(
    (f): f is { id: string; source: string } => f.source !== undefined
  );
}

function emptyFacts(): RouteFacts {
  return { cached: [], uncached: [], api: [], pending: [] };
}

/**
 * The router plugin, followed by the crawl. `wiring` is what `visio()`
 * derives for the crawl; `facts` is filled when the table is read, before
 * the crawl, for the crawl's pending check and the deploy output.
 */
export function router(
  wiring: CrawlWiring = {},
  reserved: readonly ReservedPath[] = [],
  facts: RouteFacts = emptyFacts(),
  extensions: readonly RoutesExtension[] = []
): Plugin[] {
  return [
    routerPlugin(reserved, facts, wiring, extensions),
    prerenderPlugin(facts, wiring),
  ];
}

function routerPlugin(
  reserved: readonly ReservedPath[],
  facts: RouteFacts,
  wiring: CrawlWiring,
  extensions: readonly RoutesExtension[]
): Plugin {
  let root = process.cwd();
  let routesFile = "";
  let serving = false;

  // The last check's table, its pages folder and the files it loads, for
  // the dev watcher's check of a page file added later.
  let last:
    | { table: RouteTable; dir: string; referenced: Set<string> }
    | undefined;

  // Warnings print once, not once per environment or per re-check.
  let warned = "";

  return {
    name: "visio:router",
    enforce: "pre",
    sharedDuringBuild: true,

    config() {
      return {
        // A server build or dev server that externalises this package would
        // load solid-js through Node and get a second Solid instance.
        ssr: { noExternal: [PACKAGE] },
        // Chunk names come from the module id; drop the pick query so a page
        // chunk is `home-<hash>.js`, not `home.tsx_pick_default_lang-<hash>.js`.
        build: { rollupOptions: { output: { sanitizeFileName } } },
      };
    },

    configResolved(config) {
      ({ root } = config);
      routesFile = path.resolve(root, ROUTES);
      serving = config.command === "serve";
    },

    configureServer(server) {
      // Not a post hook: solid()'s SSR handler is one, and solid() comes
      // before this plugin, so it would answer with the 404 page first.
      server.middlewares.use(
        robotsMiddleware(server.config.publicDir, () => wiring.robots?.())
      );

      // A page file that no route loads is not in the module graph, so no
      // re-check of the table sees it being written; the watcher does.
      async function check(file: string): Promise<void> {
        if (!last || !SOURCE_RE.test(file) || last.referenced.has(file)) {
          return;
        }

        if (!file.startsWith(`${last.dir}${path.sep}`)) {
          return;
        }

        const found = unusedPages(
          last.table,
          last.referenced,
          await readUnreferenced([file], last.referenced)
        );

        for (const d of found) {
          server.config.logger.warn(prefixed(d));
        }
      }

      server.watcher.on("add", check);
      server.watcher.on("change", check);
    },

    // Page modules are watch files of the routes module, so Vite invalidates
    // it when one changes and the table is checked again; no hotUpdate hook.
    transform: {
      // Every other module in the graph skips this plugin without entering JS.
      filter: { id: [PICK_RE, ROUTES_ID_RE] },
      async handler(code, id) {
        const [file, query = ""] = id.split("?");

        if (file === undefined) {
          throw new Error("split() returns one part at least.");
        }

        const pick = PICK_RE.exec(`?${query}`)?.groups?.pick;

        if (pick === "route" || pick === "default") {
          if (!SOURCE_RE.test(file)) {
            return null;
          }

          // Keep the $$moduleUrl export solid() appends in server builds; its
          // lazy() finds the client chunk through it.
          const result = pickExports(
            code,
            file,
            pick === "default" ? [pick, "$$moduleUrl"] : [pick]
          );

          return { code: result.code, map: result.map };
        }

        if (file !== routesFile) {
          return null;
        }

        const table = collectRoutes(code, file);

        if (!table) {
          return null;
        }

        const modules = new Map<string, LoadedModule>(
          await Promise.all(
            table.loaders.map(async ({ specifier, read }) => {
              const found = await this.resolve(specifier, file);
              const resolved = found?.id.split("?")[0];

              const source =
                resolved && read ? await readSource(resolved) : undefined;

              return [specifier, { id: resolved, source }] as const;
            })
          )
        );

        const result = rewriteRoutes(table, {
          environment: this.environment.name === "client" ? "client" : "server",
          modules,
          extensions,
        });

        for (const m of result.modules) {
          this.addWatchFile(m);
        }

        const dir = pagesDir(table, modules, root);

        if (dir) {
          const referenced = new Set<string>();

          for (const [, m] of modules) {
            if (m.id) {
              referenced.add(m.id);
            }
          }

          last = { table, dir, referenced };

          const candidates = await readUnreferenced(
            await sourceFiles(dir),
            referenced
          );

          result.diagnostics.push(
            ...unusedPages(table, referenced, candidates)
          );
        }

        result.diagnostics.push(...reservedPaths(table, reserved));
        const found = routeFacts(table, extensions);
        // A planned page is no fault: the reminder is for the build, and the
        // dev terminal, which the smoke run reads, stays quiet.
        result.diagnostics.push(
          ...found.diagnostics.filter(
            (d) => !(serving && d.code === "ROUTE_PENDING")
          )
        );
        // In place: visio() and the crawl hold this object.
        Object.assign(facts, found.facts);
        throwIfErrors(result.diagnostics);
        const warnings = result.diagnostics.map(prefixed);

        if (warnings.join("\n") !== warned) {
          warned = warnings.join("\n");

          for (const w of warnings) {
            this.warn(w);
          }
        }

        if (!result.changed) {
          return null;
        }

        return { code: result.code, map: result.map };
      },
    },
  };
}
