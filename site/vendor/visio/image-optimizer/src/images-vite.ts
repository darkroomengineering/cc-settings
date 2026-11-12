import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import { pruneCache } from "./cache.ts";
import {
  DEFAULT_WIDTHS,
  INPUT_EXTENSIONS,
  MIME,
  optimizeImage,
  srcset,
} from "./optimize.ts";
import { selectWidths } from "./select.ts";
import type {
  ImageFormat,
  ImageVariant,
  OptimizedImage,
  ImageOptions,
} from "./types.ts";
import {
  assetHost,
  escapeRegExp,
  safeName,
  splitQuery,
} from "./vite-assets.ts";

const QUERY = "responsive";
const QUERY_RE = `\\?(?:[^#]*&)?${QUERY}(?:[=&]|$)`;
const DEV_PREFIX = "/@visio/images/";

/** What the module needs from an optimized image: everything but the bytes. */
type ModuleImage = Omit<OptimizedImage, "variants"> & {
  variants: Pick<ImageVariant, "name" | "width" | "format">[];
};

function isResponsive(id: string): boolean {
  const { file, query } = splitQuery(id);

  return (
    query.has(QUERY) &&
    INPUT_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase())
  );
}

/** The module for an image, `urls[i]` the URL expression of `image.variants[i]`. */
function moduleCode(image: ModuleImage, urls: string[]): string {
  // One const per variant keeps the bundler's file-url placeholders in plain expressions.
  const consts: string[] = [];
  const byFormat = new Map<ImageFormat, { url: string; width: number }[]>();

  for (const [i, v] of image.variants.entries()) {
    consts.push(`const u${i} = ${urls[i]};`);
    const list = byFormat.get(v.format) ?? [];
    list.push({ url: `\${u${i}}`, width: v.width });
    byFormat.set(v.format, list);
  }

  const img = byFormat.get(image.format) ?? [];

  const sources = byFormat
    .entries()
    .filter(([format]) => format !== image.format)
    .map(
      ([format, list]) =>
        `{ type: ${JSON.stringify(MIME[format])}, srcset: \`${srcset(list)}\` }`
    )
    .toArray();

  const largest = img.at(-1);

  return [
    ...consts,
    "export default {",
    `  src: ${largest ? `\`${largest.url}\`` : '""'},`,
    `  srcset: \`${srcset(img)}\`,`,
    `  sources: [${sources.join(", ")}],`,
    `  width: ${image.width},`,
    `  height: ${image.height},`,
    `  aspectRatio: ${image.aspectRatio},`,
    `  widths: ${JSON.stringify(image.widths)},`,
    `  placeholder: ${JSON.stringify(image.placeholder ?? "")},`,
    "};",
  ].join("\n");
}

/** Tests set `widths` and `placeholder`; the public `images()` takes none. */
export function images(
  options: Pick<ImageOptions, "widths" | "placeholder"> = {}
): Plugin {
  let config: ResolvedConfig;
  let cacheDir = "";
  const assets = assetHost(DEV_PREFIX);
  /**
   * Module id -> image without bytes, from the client build; the server
   * build reads it instead of encoding again.
   */
  const built = new Map<string, ModuleImage>();
  /** The build's cache files, and each variant by name: `true` when it came from the cache. */
  const used = new Set<string>();
  const variants = new Map<string, boolean>();

  return {
    name: "visio:images",
    enforce: "pre",
    sharedDuringBuild: true,

    configResolved(resolved) {
      config = resolved;
      cacheDir = path.join(resolved.cacheDir, "visio-images");
      assets.configure(resolved);
    },

    resolveId: {
      // Any file: `?responsive` on one it cannot read is an error below.
      filter: { id: new RegExp(`[?&]${QUERY}(?:[=&]|$)`, "u") },
      async handler(source, importer) {
        const { file, query } = splitQuery(source);

        if (!query.has(QUERY)) {
          return null;
        }

        // `x.svg?responsive` is svg()'s.
        if (path.extname(file).toLowerCase() === ".svg") {
          return null;
        }

        // Anything else would fall through to Vite as a URL string typed as a ResponsiveImage.
        if (!isResponsive(source)) {
          this.error(
            `[@visio/image-optimizer] ?responsive reads ${[...INPUT_EXTENSIONS, "svg"].join(", ")} files, not ${file}.`
          );
        }

        const resolved = await this.resolve(file, importer, { skipSelf: true });

        if (!resolved) {
          return null;
        }

        return `${resolved.id.split("?")[0]}?${query.toString()}`;
      },
    },

    load: {
      filter: {
        id: new RegExp(
          `\\.(?:${[...INPUT_EXTENSIONS].map(escapeRegExp).join("|")})${QUERY_RE}`,
          "iu"
        ),
      },
      async handler(id) {
        if (!isResponsive(id)) {
          return null;
        }

        const { file, query } = splitQuery(id);
        this.addWatchFile(file);

        // A server build after the client's: every variant already has its
        // final client name. Anything missing (dev, or a server build on its
        // own) takes the full path below.
        const known = built.get(id);

        if (known) {
          const urls = known.variants.map((v) =>
            assets.clientUrl(this, v.name)
          );

          if (urls.every((u) => u !== undefined)) {
            return {
              code: moduleCode(
                known,
                urls.map((u) => JSON.stringify(u))
              ),
              map: null,
            };
          }
        }

        const source = new Uint8Array(await readFile(file));
        const name = safeName(file);
        let widths = options.widths ?? DEFAULT_WIDTHS;
        const sizes = query.getAll("sizes");

        if (sizes.length) {
          const picked = selectWidths(widths, sizes);

          if (picked) {
            widths = picked;
          } else {
            this.warn(
              `[@visio/image-optimizer] could not read sizes ${sizes.map((s) => JSON.stringify(s)).join(", ")} for ${path.relative(config.root, file)}; every width was emitted.`
            );
          }
        }

        const build = config.command === "build";

        const image = await optimizeImage(source, {
          ...options,
          widths,
          cacheDir,
          name,
          used: build ? used : undefined,
        });

        // Two imports of one file share its variants; one that was encoded counts as encoded.
        if (build) {
          for (const v of image.variants) {
            variants.set(v.name, (variants.get(v.name) ?? true) && v.cached);
          }
        }

        assets.replace(id);

        const urls = image.variants.map((v) =>
          assets.url(this, id, v.name, v.bytes, MIME[v.format])
        );

        if (build && this.environment.name === "client") {
          built.set(id, {
            ...image,
            variants: image.variants.map((v) => ({
              name: v.name,
              width: v.width,
              format: v.format,
            })),
          });
        }

        return { code: moduleCode(image, urls), map: null };
      },
    },

    generateBundle() {
      assets.generateBundle(this);
    },

    // After the last environment, so a server-only image counts as used.
    async writeBundle() {
      const last =
        "ssr" in this.environment.getTopLevelConfig().environments
          ? "ssr"
          : "client";

      if (config.command !== "build" || this.environment.name !== last) {
        return;
      }

      if (variants.size) {
        const cached = [...variants.values()].filter(Boolean).length;
        this.environment.logger.info(
          `[@visio/image-optimizer] ${variants.size} image files: ${cached} from the cache, ${variants.size - cached} encoded`
        );
      }

      await pruneCache(cacheDir, used);
    },

    configureServer(server) {
      assets.configureServer(server);
    },
  };
}
