import path from "node:path";

import type { EnvironmentModuleNode, Plugin, ResolvedConfig } from "vite";

import { locateSheet, shiftMap } from "./asset-map.ts";
import { formatDiagnostic } from "./compiler/errors.ts";
import type { Diagnostic } from "./compiler/errors.ts";
import { group } from "./compiler/match.ts";
import { isString } from "./guards.ts";
import { tokenVarName } from "./helpers.ts";
import { buildVerdict, formatFindings, formatReport } from "./lint/report.ts";
import type { Report } from "./lint/report.ts";
import { ARTIFACTS_DIR, Project, SOURCE_FILE } from "./project.ts";
import type {
  FontFile,
  FontUrls,
  ProjectOptions,
  Stylesheet,
} from "./project.ts";

/** The options of `styling()` and the switches that only tests use. */
export interface StylingOptions extends Omit<
  ProjectOptions,
  "root" | "cacheDir"
> {
  /** Write `.visio/app.css`, `.visio/app.css.map` and `.visio/report.json`. Default true. */
  writeArtifacts?: boolean;
  /** Fail the build on report findings. Default true. */
  strictReport?: boolean;
}

interface ModuleGraphLike {
  getModuleById: (id: string) => EnvironmentModuleNode | undefined;
  getModulesByFile: (file: string) => Set<EnvironmentModuleNode> | undefined;
  invalidateModule: (mod: EnvironmentModuleNode) => void;
}

/** Vite's chunk-order markers, present in a CSS asset until it is written. */
const MARKER_RE = /\/\*\$vite\$:\d+\*\//gv;

/** The url the bundled sheet uses for a font file, or the file name when it is not there. */
function urlInAsset(css: string, fileName: string): string {
  // Vite writes `Host[wght].woff2` as `Host%5Bwght%5D.woff2`.
  const escaped = `(?:${[...new Set([fileName, encodeURI(fileName)])].map(escapeRegExp).join("|")})`;

  const match = css.match(
    new RegExp(`url\\((?<q>"?)(?<url>[^"\\)]*${escaped})\\k<q>\\)`, "v")
  );

  return match ? group(match, "url") : fileName;
}

/**
 * The start of the sheet up to its first `url(`: text that is the same
 * whatever urls the fonts get. A CSS asset without it does not hold the
 * sheet, so the sheet is not built again with that asset's urls.
 */
function sheetProbe(css: string): string {
  const at = css.indexOf("url(");

  return (at === -1 ? css : css.slice(0, at)).trim().slice(0, 256);
}

/** How long dev waits after the last sheet load before it writes `.visio`. */
const ARTIFACTS_DELAY = 200;

/** `base` + a built file name: `/assets/x`, `./assets/x`, `https://cdn/app/assets/x`, or `assets/x` for an empty base. */
function joinUrl(base: string, fileName: string): string {
  if (base === "") {
    return fileName;
  }

  return `${base.endsWith("/") ? base : `${base}/`}${fileName}`;
}

function prefixed(d: Diagnostic) {
  return `[@visio/styling] ${formatDiagnostic(d)}`;
}

function errorsOf(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === "error");
}

/** Throws a compile's errors, for the build log or the browser overlay. Warnings go to the report. */
function throwIfErrors(diagnostics: Diagnostic[]) {
  const errors = errorsOf(diagnostics);

  if (errors.length) {
    throw new Error(errors.map(prefixed).join("\n\n"));
  }
}

/** A string as a literal piece of a RegExp. */
function escapeRegExp(s: string) {
  return s.replaceAll(/[.*+?^$\{\}\(\)\|\[\]\\\/]/gv, "\\$&");
}

const CSS_SPECIFIER = "@visio/styling/css";
const CSS_ID = "\0visio.css";

/** How a `\0` virtual id is written in a URL, where a null byte cannot appear. */
const NULL_BYTE_PLACEHOLDER = "/@id/__x00__";
const FONT_PREFIX = "/@visio/fonts/";

export function styling(options: StylingOptions = {}): Plugin[] {
  let config: ResolvedConfig;
  let project: Project;
  let cssImported = false;
  /** Font file name -> asset reference id, from the client build. */
  const refIds = new Map<string, string>();

  /**
   * Error text last logged per file in dev, so a file compiled for several
   * environments logs once, and again only when its errors change.
   */
  const loggedErrors = new Map<string, string>();
  /** The findings dev printed last; the terminal hears again only when they change. */
  let shownFindings = "";

  /**
   * Environments that built against the current scan. The builder runs the
   * client and the server one after the other on this one instance, and one
   * scan serves both. An environment that builds again (watch mode, a
   * second builder run) starts a new scan.
   */
  const scannedFor = new Set<string>();

  /** The tokens module as last loaded, so a save reloads it once, not once per environment. */
  let tokensCode: string | undefined;

  /** The sheet dev served last, waiting to be written to `.visio`. */
  let pendingSheet: Stylesheet | null = null;
  /** Set when a scan, a compile, or a load may have changed the report. */
  let reportDue = false;
  let artifactsTimer: ReturnType<typeof setTimeout> | undefined;
  /** Writes run one after the other, so an older one never lands last. */
  let artifactsWrite: Promise<void> = Promise.resolve();

  /**
   * Dev builds the report once loads and saves settle, never inside `load`
   * or `hotUpdate`: it parses every value and runs the a11y checks.
   */
  function scheduleReport(sheet?: Stylesheet) {
    if (sheet) {
      pendingSheet = sheet;
    }

    reportDue = true;
    clearTimeout(artifactsTimer);
    artifactsTimer = setTimeout(flushArtifacts, ARTIFACTS_DELAY);
    artifactsTimer.unref?.();
  }

  async function writeAfter(
    previous: Promise<void>,
    sheet: Stylesheet | undefined,
    report: Report
  ) {
    await previous;

    try {
      await project.writeArtifacts(sheet, report);
    } catch (error) {
      config.logger.warn(
        `[@visio/styling] could not write ${ARTIFACTS_DIR}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function flushArtifacts(): Promise<void> {
    clearTimeout(artifactsTimer);

    if (!reportDue) {
      return artifactsWrite;
    }

    reportDue = false;
    const sheet = pendingSheet;
    pendingSheet = null;
    const report = project.report(sheet?.pruned);
    printFindings(report);

    if (options.writeArtifacts !== false) {
      artifactsWrite = writeAfter(artifactsWrite, sheet ?? undefined, report);
    }

    return artifactsWrite;
  }

  /**
   * The findings in the dev terminal, where the agent reads them, each time
   * the list changes, with what they do to the build.
   */
  function printFindings(report: Report) {
    const text = report.findings.length
      ? formatFindings(
          report.findings,
          buildVerdict(options.strictReport !== false)
        )
      : "";

    if (text === shownFindings) {
      return;
    }

    const before = shownFindings;
    shownFindings = text;

    if (text) {
      config.logger.warn(`[@visio/styling] ${text}`, { timestamp: true });
    } else if (before) {
      config.logger.info("[@visio/styling] no findings left.", {
        timestamp: true,
      });
    }
  }

  /**
   * Logs one file's errors to the dev terminal when they change. Vite sends
   * an error thrown in `hotUpdate` to the browser overlay only, and the scan
   * at start has no browser to send one to, so both log here.
   */
  function logErrors(file: string, diagnostics: Diagnostic[]) {
    const text = errorsOf(diagnostics).map(prefixed).join("\n");

    if (text && text !== loggedErrors.get(file)) {
      config.logger.error(text, { timestamp: true });
    }

    if (text) {
      loggedErrors.set(file, text);
    } else {
      loggedErrors.delete(file);
    }
  }

  /**
   * Compiles every file, then subsets the fonts: `subset: 'used'` needs
   * every file's text. A build stops on the first file with errors. Dev logs
   * every one and keeps serving; a module with errors still fails when it is
   * requested, since `transform` throws them.
   */
  async function prescan() {
    const diagnostics = await project.scan();

    if (config.command === "build") {
      throwIfErrors(diagnostics);
    } else {
      loggedErrors.clear();
      const byFile = Map.groupBy(errorsOf(diagnostics), (d) => d.file ?? "");

      for (const [file, errors] of byFile) {
        logErrors(file, errors);
      }

      scheduleReport();
    }

    await project.optimizeFonts();
  }

  // The server-rendered head reads the sheet as `?direct`, a module of its own.
  function invalidateSheet(graph: ModuleGraphLike) {
    for (const m of graph.getModulesByFile(CSS_ID) ?? []) {
      graph.invalidateModule(m);
    }

    return graph.getModuleById(CSS_ID);
  }

  /** Font names are content hashes; everything that wrote one has to be rebuilt. */
  function invalidateFontConsumers(env: { moduleGraph: ModuleGraphLike }) {
    const graph = env.moduleGraph;
    invalidateSheet(graph);

    for (const m of graph.getModulesByFile(project.tokensPath) ?? []) {
      graph.invalidateModule(m);
    }
  }

  /**
   * Where the client build writes a font: `<assetsDir>/<name>`, or just the
   * name when the client's `build.assetsDir` is empty. The client
   * environment's setting is the one that matters; `config` may belong to
   * whichever environment resolved last.
   */
  function builtFileName(name: string): string {
    const assetsDir =
      config.environments.client?.build.assetsDir ?? config.build.assetsDir;

    return assetsDir ? `${assetsDir}/${name}` : name;
  }

  /**
   * The URL a built font has once the client bundle is on disk. Font names
   * are content hashes and the client build emits them under a fixed file
   * name, so the path is known before that build runs: a server build in
   * its own process (`vite build --ssr`) bakes in the same URL the client
   * build produces. `experimental.renderBuiltUrl` gets the call Vite makes
   * for the client's own asset URLs, so a CDN prefix reaches the server
   * bundle too; the URL is the one browsers load, hence `ssr: false`.
   */
  function builtFontUrl(
    file: FontFile,
    hostType: "css" | "js",
    hostId: string
  ): string {
    const fileName = builtFileName(file.name);

    const rendered = config.experimental?.renderBuiltUrl?.(fileName, {
      type: "asset",
      hostId,
      hostType,
      ssr: false,
    });

    if (isString(rendered)) {
      return rendered;
    }

    if (rendered !== undefined) {
      config.logger.warn(
        `[@visio/styling] experimental.renderBuiltUrl returned ${JSON.stringify(rendered)} for "${fileName}"; a server build needs a plain URL and used the base path instead.`
      );
    }

    return joinUrl(config.base, fileName);
  }

  /**
   * Where a font file lives. In the client build that is an asset placeholder
   * the bundler resolves, different for CSS `url()` and for JS; every other
   * build gets the built URL. Plain URLs are returned unquoted; the tokens
   * injector quotes them.
   */
  function fontUrl(file: FontFile, env: string, kind: "css" | "js"): string {
    if (config.command === "serve") {
      return `${FONT_PREFIX}${file.name}`;
    }

    const ref = refIds.get(file.name);

    if (env === "client" && ref) {
      return kind === "css"
        ? `__VITE_ASSET__${ref}__`
        : `import.meta.ROLLUP_FILE_URL_${ref}`;
    }

    return builtFontUrl(
      file,
      kind,
      kind === "css" ? CSS_ID : project.tokensPath
    );
  }

  function fontUrls(env: string, kind: "css" | "js"): FontUrls {
    return project.fontUrls((file) => fontUrl(file, env, kind));
  }

  const main: Plugin = {
    name: "visio:styling",
    enforce: "pre",
    sharedDuringBuild: true,

    config(user) {
      // The stylesheet maps back to the .tsx that produced each rule; let
      // devtools show that instead of the virtual module.
      if (user.css?.devSourcemap === undefined) {
        return { css: { devSourcemap: true } };
      }
    },

    async configResolved(resolved) {
      config = resolved;
      project = new Project({
        ...options,
        root: resolved.root,
        cacheDir: path.join(resolved.cacheDir, "visio-fonts"),
      });
      await project.loadTokens();
    },

    async buildStart() {
      this.addWatchFile(project.tokensPath);

      if (config.command !== "build") {
        return;
      }

      const env = this.environment.name;

      if (scannedFor.size === 0 || scannedFor.has(env)) {
        scannedFor.clear();
        await prescan();
      }

      scannedFor.add(env);

      if (env !== "client") {
        return;
      }

      // Reference ids belong to one build. A rebuild of the same plugin
      // instance (watch mode, a builder run twice) emits the assets again.
      refIds.clear();
      // Ship only the fonts something references; the sheet prunes the rest too.
      const used = options.prune === false ? null : project.usedVars();

      for (const file of project.fonts) {
        if (used && !used.has(tokenVarName("fonts", file.key))) {
          continue;
        }

        // Two token fonts on one file with the same subset and axes produce
        // one name and one asset; both URLs point at it.
        if (refIds.has(file.name)) {
          continue;
        }

        const ref = this.emitFile({
          type: "asset",
          fileName: builtFileName(file.name),
          source: file.bytes,
        });

        refIds.set(file.name, ref);
      }
    },

    async configureServer(server) {
      await prescan();
      server.middlewares.use(FONT_PREFIX, (req, res, next) => {
        const [raw = ""] = (req.url ?? "").replace(/^\//v, "").split("?");
        // The browser asks for `ABC%20Diatype-….woff2`.
        const name = decodeURIComponent(raw);
        const file = project.fonts.find((f) => f.name === name);

        if (!file) {
          return next();
        }

        res.setHeader("Content-Type", "font/woff2");
        res.setHeader("Cache-Control", "no-cache");
        res.end(Buffer.from(file.bytes));
      });
    },

    resolveId: {
      filter: {
        id: new RegExp(
          `^(?:${escapeRegExp(CSS_SPECIFIER)}$|(?:\\0|${escapeRegExp(NULL_BYTE_PLACEHOLDER)})${escapeRegExp(CSS_ID.slice(1))}(?:\\?|$))`,
          "u"
        ),
      },
      handler(source) {
        if (source === CSS_SPECIFIER) {
          cssImported = true;

          return CSS_ID;
        }

        // The sheet's own id with a query: `?direct` is how the Solid plugin's
        // dev middleware and Vite's <link> handling ask for the CSS text, so
        // the entry styles land in the streamed <head>. The id arrives bare or
        // in the `/@id/__x00__` form Vite uses in URLs; hand back the bare id
        // and keep the query, which Vite's css plugin reads.
        const id = source.replace(NULL_BYTE_PLACEHOLDER, "\0");

        if (id.split("?")[0] === CSS_ID) {
          return id;
        }

        return null;
      },
    },

    load: {
      filter: { id: new RegExp(`^${escapeRegExp(CSS_ID)}(?:\\?|$)`, "u") },
      handler(id) {
        if (id.split("?")[0] !== CSS_ID) {
          return null;
        }

        // Only the client build ships the sheet; a server build links the
        // client's built asset through the manifest. Handing the server build
        // the real sheet would only make Vite try to resolve the font urls
        // against a bundle that has none.
        if (config.command === "build" && this.environment.name !== "client") {
          return { code: "" };
        }

        const sheet = project.css({
          minify: config.command === "build",
          fontUrls: fontUrls(this.environment.name, "css"),
        });

        project.markSheetClean();

        if (config.command === "serve") {
          scheduleReport(sheet);
        }

        return { code: sheet.css, map: sheet.map };
      },
    },

    transform: {
      // Generated SVG components hold no styles; `shouldCompile` has the other rules.
      filter: { id: { include: SOURCE_FILE, exclude: /\.svg\.tsx\?/u } },
      handler(code, id) {
        if (!project.shouldCompile(id)) {
          return null;
        }

        if (id.split("?")[0] === project.tokensPath) {
          return project.injectFontUrls(
            code,
            fontUrls(this.environment.name, "js")
          );
        }

        const result = project.compile(id, code);
        throwIfErrors(result.diagnostics);

        if (!result.changed) {
          return null;
        }

        return { code: result.code, map: result.map };
      },
    },

    async hotUpdate({ type, file, modules, read, server }) {
      if (file === project.tokensPath) {
        const code = await read();

        if (code !== tokensCode) {
          tokensCode = code;
          await project.loadTokens();
          await prescan();
        }

        invalidateFontConsumers(this.environment);
        const graph = this.environment.moduleGraph;

        // A module's class names hold the token values it was compiled with.
        for (const [source, mods] of graph.fileToModulesMap) {
          if (project.shouldCompile(source)) {
            for (const m of mods) {
              graph.invalidateModule(m);
            }
          }
        }

        this.environment.hot.send({ type: "full-reload" });

        return [];
      }

      if (!project.shouldCompile(file)) {
        return;
      }

      if (type === "delete") {
        project.forget(file);
        scheduleReport();

        if (!project.sheetChanged) {
          return;
        }

        const cssModule = invalidateSheet(this.environment.moduleGraph);

        return cssModule ? [...modules, cssModule] : undefined;
      }

      // Register before Vite re-fetches so the stylesheet is already current.
      const subsets = project.subsetsUsedChars();
      const before = subsets ? project.usedChars() : "";
      const result = project.compile(file, await read());
      logErrors(path.relative(project.root, file), result.diagnostics);
      scheduleReport();
      throwIfErrors(result.diagnostics);

      if (subsets && project.usedChars() !== before) {
        // New characters mean new font files and names; start over. Vite calls
        // this hook once per environment and the first call already changed
        // the character set, so every environment is invalidated here.
        await project.optimizeFonts();

        for (const env of Object.values(server.environments)) {
          invalidateFontConsumers(env);
        }

        this.environment.hot.send({ type: "full-reload" });

        return [];
      }

      if (project.sheetChanged) {
        const cssModule = invalidateSheet(this.environment.moduleGraph);

        if (cssModule) {
          return [...modules, cssModule];
        }
      }
    },

    generateBundle(_, bundle) {
      if (this.environment.name !== "client") {
        return;
      }

      // The server build derives these names; make sure the client agrees.
      for (const [name, ref] of refIds) {
        const built = this.getFileName(ref);
        const expected = builtFileName(name);

        if (built !== expected) {
          throw new Error(
            `[@visio/styling] font "${name}" was written as "${built}", not "${expected}", so a server build would point at the wrong file.`
          );
        }
      }

      // Vite emits no CSS maps in build, and the sheet survives its minifier
      // byte for byte, so ship ours. With no import, no asset holds the sheet.
      const { build } = this.environment.config;

      if (!build.sourcemap || !cssImported) {
        return;
      }

      // The sheet `load` served, from the cache.
      const probe = sheetProbe(
        project.css({
          minify: true,
          fontUrls: fontUrls(this.environment.name, "css"),
        }).css
      );

      let placed = false;

      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) {
          continue;
        }

        // Vite's chunk-order markers are still in the asset at this point and
        // are stripped before the file is written; the font urls are final
        // (absolute or relative to the asset, per `base`). Build the map from
        // a sheet with those exact urls and find it in the marker-free asset,
        // which may also hold other stylesheets the chunk imported.
        const source = String(asset.source);
        const written = source.replaceAll(MARKER_RE, "");

        if (!written.includes(probe)) {
          continue;
        }

        const sheet = project.css({
          minify: true,
          fontUrls: project.fontUrls((f) => urlInAsset(source, f.name)),
        });

        const at = locateSheet(written, sheet.css);

        if (!at) {
          continue;
        }

        placed = true;
        const mapName = `${asset.fileName}.map`;

        // Like Vite's JS maps: sources relative to the asset, no machine paths.
        // SAFETY: shiftMap() returns the sheet's own source map, which always
        // has `sources`.
        const map = JSON.parse(shiftMap(sheet.map, at.line, at.column)) as {
          sources: string[];
        };

        // The environment's own outDir: the client writes to `dist/client`.
        const assetDir = path.dirname(
          path.resolve(config.root, build.outDir, asset.fileName)
        );

        map.sources = map.sources.map((s) => path.relative(assetDir, s));
        this.emitFile({
          type: "asset",
          fileName: mapName,
          source: JSON.stringify(map),
        });

        if (build.sourcemap !== "hidden") {
          asset.source = `${source}\n/*# sourceMappingURL=${mapName.split("/").pop()} */`;
        }
      }

      if (!placed) {
        this.warn(
          "[@visio/styling] the CSS source map was dropped: the stylesheet is not in any CSS asset verbatim, so another plugin or minifier rewrote it after this one."
        );
      }
    },

    buildEnd() {
      if (config.command !== "build") {
        return;
      }

      if (!cssImported) {
        this.warn(
          `[@visio/styling] nothing imported "${CSS_SPECIFIER}". Add it to src/app.tsx or the stylesheet will not ship.`
        );
      }
    },

    async closeBundle() {
      // The dev server is closing: write what is still waiting.
      if (config.command === "serve") {
        return flushArtifacts();
      }

      if (this.environment.name !== "client") {
        return;
      }

      const sheet =
        options.writeArtifacts === false
          ? null
          : project.css({
              minify: true,
              fontUrls: fontUrls("artifacts", "css"),
            });

      const report = project.report(sheet?.pruned);
      config.logger.info(
        formatReport(report, buildVerdict(options.strictReport !== false))
      );

      if (options.strictReport !== false && report.findings.length) {
        throw new Error(
          "[@visio/styling] the report has findings, and each fails the build."
        );
      }

      if (sheet) {
        await project.writeArtifacts(sheet, report);
      }
    },
  };

  return [main];
}
