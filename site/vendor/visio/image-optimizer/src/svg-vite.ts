import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import { contentHash } from "./cache.ts";
import {
  defsComponent,
  optimizeDefs,
  optimizeSvg,
  svgComponent,
  viewBoxSize,
} from "./svg.ts";
import type { OptimizedSvg, SvgOptions } from "./svg.ts";
import {
  assetHost,
  escapeRegExp,
  safeName,
  splitQuery,
} from "./vite-assets.ts";

const DEV_PREFIX = "/@visio/svg/";
const COMPONENT_EXT = ".tsx";

/** `x.svg`, or the component module's own id, `x.svg.tsx`. */
const SVG_FILE = `\\.svg(?:${escapeRegExp(COMPONENT_EXT)})?`;

function isSvg(file: string): boolean {
  return path.extname(file).toLowerCase() === ".svg";
}

function componentId(file: string, kind: Inline = "component"): string {
  return `${file}${COMPONENT_EXT}?${kind}`;
}

const INLINE = ["component", "defs"] as const;

type Inline = (typeof INLINE)[number];

function px(value: string | undefined): number | undefined {
  const n = Number(value?.replace(/px$/v, ""));

  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Width and height in px: the file's own when they are numbers, else the viewBox's. */
function pixelSize(
  file: OptimizedSvg
): { width: number; height: number } | undefined {
  const width = px(file.width);
  const height = px(file.height);

  if (width && height) {
    return { width, height };
  }

  const { viewBox } = file.root.attributes;

  return viewBox === undefined ? undefined : viewBoxSize(viewBox);
}

/** A `ResponsiveImage` with one file: a vector has no widths to pick from. */
function vectorModule(
  url: string,
  { width, height }: { width: number; height: number }
): string {
  return [
    `const src = ${url};`,
    "export default {",
    "  src,",
    "  srcset: '',",
    "  sources: [],",
    `  width: ${width},`,
    `  height: ${height},`,
    `  aspectRatio: ${width / height},`,
    `  widths: [${width}],`,
    "  placeholder: '',",
    "};",
  ].join("\n");
}

/** Tests add SVGO `plugins`; the public `svg()` takes none. */
export function svg(options: Pick<SvgOptions, "plugins"> = {}): Plugin {
  let config: ResolvedConfig;
  const assets = assetHost(DEV_PREFIX);

  /**
   * File -> SVGO result and the file's mtime, shared across
   * environments and import kinds.
   */
  const results = new Map<
    string,
    { mtimeMs: number; svg: Promise<OptimizedSvg> }
  >();

  const defsIds = new Map<string, string[]>();

  function warnDuplicateIds(
    warn: (message: string) => void,
    file: string,
    ids: string[]
  ) {
    // Both environments load the file; the second load has nothing new to say.
    if (defsIds.get(file)?.join("\n") === ids.join("\n")) {
      return;
    }

    defsIds.set(file, ids);

    for (const [other, taken] of defsIds) {
      const shared =
        other === file ? [] : ids.filter((id) => taken.includes(id));

      if (shared.length > 0) {
        warn(
          `[@visio/image-optimizer] ${path.relative(config.root, file)}?defs and ${path.relative(config.root, other)}?defs both have the id ${shared.map((id) => JSON.stringify(id)).join(", ")}. A page uses the first one it renders; rename the id in one file.`
        );
      }
    }
  }

  async function optimizeSource<T>(
    file: string,
    run: (source: string, options: SvgOptions) => T
  ): Promise<T> {
    const source = await readFile(file, "utf-8");

    try {
      return run(source, {
        ...options,
        path: path.relative(config.root, file),
      });
    } catch (error) {
      throw new Error(
        `[@visio/image-optimizer] could not optimize ${path.relative(config.root, file)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  async function optimizeFile(file: string): Promise<OptimizedSvg> {
    const { mtimeMs } = await stat(file);
    const hit = results.get(file);

    if (hit?.mtimeMs === mtimeMs) {
      return hit.svg;
    }

    const run = optimizeSource(file, optimizeSvg);
    results.set(file, { mtimeMs, svg: run });

    try {
      return await run;
    } catch (error) {
      // A failed run is not kept, so the next load tries again.
      if (results.get(file)?.svg === run) {
        results.delete(file);
      }

      throw error;
    }
  }

  return {
    name: "visio:svg",
    enforce: "pre",
    sharedDuringBuild: true,

    configResolved(resolved) {
      config = resolved;
      assets.configure(resolved);
    },

    resolveId: {
      filter: {
        id: new RegExp(
          `${SVG_FILE}\\?(?:[^#]*&)?(?:component|defs|responsive)(?:[=&]|$)`,
          "iu"
        ),
      },
      async handler(source, importer) {
        const { file, query } = splitQuery(source);

        if (query.has("responsive") && isSvg(file)) {
          const resolved = await this.resolve(file, importer, {
            skipSelf: true,
          });

          return resolved ? `${resolved.id.split("?")[0]}?responsive` : null;
        }

        const kind = INLINE.find((k) => query.has(k));

        if (!kind) {
          return null;
        }

        if (query.has("mono")) {
          this.error(
            `[@visio/image-optimizer] ${file}?component&mono: &mono is gone. Write fill="currentColor" (or stroke) in the file itself, so every import of it takes the CSS color, and import it with ?component.`
          );
        }

        // `x.svg?component` from source, or the module's own id (`x.svg.tsx?component`)
        // when the dev server resolves a URL it has already handed out.
        const svgFile = file.endsWith(`.svg${COMPONENT_EXT}`)
          ? file.slice(0, -COMPONENT_EXT.length)
          : file;

        if (!isSvg(svgFile)) {
          return null;
        }

        const resolved = await this.resolve(svgFile, importer, {
          skipSelf: true,
        });

        if (!resolved) {
          return null;
        }

        return componentId(splitQuery(resolved.id).file, kind);
      },
    },

    load: {
      filter: { id: new RegExp(`${SVG_FILE}(?:\\?|$)`, "iu") },
      async handler(id) {
        const { file, query } = splitQuery(id);

        if (query.has("component") && file.endsWith(`.svg${COMPONENT_EXT}`)) {
          const svgFile = file.slice(0, -COMPONENT_EXT.length);
          this.addWatchFile(svgFile);

          return { code: svgComponent(await optimizeFile(svgFile)), map: null };
        }

        if (query.has("defs") && file.endsWith(`.svg${COMPONENT_EXT}`)) {
          const svgFile = file.slice(0, -COMPONENT_EXT.length);
          this.addWatchFile(svgFile);

          const defs = await optimizeSource(svgFile, optimizeDefs);

          warnDuplicateIds((message) => this.warn(message), svgFile, defs.ids);

          return { code: defsComponent(defs), map: null };
        }

        if (!isSvg(file)) {
          return null;
        }

        const responsive = query.has("responsive");

        // Any other query (?raw, ?inline, ?no-inline) is for another plugin.
        if (!responsive && [...query.keys()].some((k) => k !== "url")) {
          return null;
        }

        const optimized = await optimizeFile(file);
        const name = `${safeName(file)}-${contentHash(Buffer.from(optimized.svg))}.svg`;
        assets.replace(id);
        const url = assets.url(this, id, name, optimized.svg, "image/svg+xml");

        if (!responsive) {
          return { code: `export default ${url};`, map: null };
        }

        const size = pixelSize(optimized);

        if (!size) {
          this.error(
            `[@visio/image-optimizer] ${path.relative(config.root, file)} needs a viewBox, or a width and height in px, for ?responsive to size its box.`
          );
        }

        return { code: vectorModule(url, size), map: null };
      },
    },

    hotUpdate({ type, file, modules }) {
      if (!isSvg(file)) {
        return;
      }

      results.delete(file);

      if (type === "delete") {
        defsIds.delete(file);
      }

      // The component modules' ids are not the file's, so Vite's file lookup
      // misses them; hand it the modules that render this file inline.
      const graph = this.environment.moduleGraph;

      const inline = INLINE.flatMap((kind) => {
        const m = graph.getModuleById(componentId(file, kind));

        return m && !modules.includes(m) ? [m] : [];
      });

      if (inline.length === 0) {
        return;
      }

      for (const m of inline) {
        graph.invalidateModule(m);
      }

      return [...modules, ...inline];
    },

    generateBundle() {
      assets.generateBundle(this);
    },

    configureServer(server) {
      assets.configureServer(server);
    },
  };
}
