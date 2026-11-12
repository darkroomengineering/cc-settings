import type { ServerResponse } from "node:http";
import path from "node:path";

import type { Connect, ResolvedConfig, ViteDevServer } from "vite";

/** A string as a literal piece of a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^$\{\}\(\)\|\[\]\\\/]/gv, "\\$&");
}

export function splitQuery(id: string): {
  file: string;
  query: URLSearchParams;
} {
  const at = id.indexOf("?");

  return at === -1
    ? { file: id, query: new URLSearchParams() }
    : { file: id.slice(0, at), query: new URLSearchParams(id.slice(at + 1)) };
}

/**
 * A file's base name reduced to `[\w-]`, for output file names. A space or a
 * comma would break a `srcset`, and the dev middleware matches names as they
 * are written, not URL-decoded.
 */
export function safeName(file: string): string {
  return path.basename(file, path.extname(file)).replaceAll(/[^\w\-]+/gv, "-");
}

/** The parts of a `load` context the URL branch uses. */
interface LoadContext {
  environment: { name: string };
  emitFile: (file: {
    type: "asset";
    name: string;
    source: string | Uint8Array;
  }) => string;
}

/** The parts of a `generateBundle` context the URL branch uses. */
interface BundleContext {
  environment: { name: string };
  getFileName: (referenceId: string) => string;
}

export interface AssetHost {
  /** Call from `configResolved`. */
  configure: (config: ResolvedConfig) => void;
  /**
   * The module expression for the URL of the file `name`, for the current
   * environment. `owner` is the module id that loads it.
   */
  url: (
    ctx: LoadContext,
    owner: string,
    name: string,
    source: string | Uint8Array,
    mime: string
  ) => string;
  /**
   * Call from `load` before `url()`: in dev, stops serving the files `owner`
   * registered last time, unless another module still uses them.
   */
  replace: (owner: string) => void;
  /**
   * The client's final URL for `name` in a server build, once the client
   * bundle is written. Undefined in dev, in the client, and for a file the
   * client never emitted.
   */
  clientUrl: (
    ctx: { environment: { name: string } },
    name: string
  ) => string | undefined;
  /** Call from `generateBundle`: records the client's final file names. */
  generateBundle: (ctx: BundleContext) => void;
  /** Call from `configureServer`: serves the dev files from memory. */
  configureServer: (server: ViteDevServer) => void;
}

export function assetHost(prefix: string): AssetHost {
  let config: ResolvedConfig;
  /** Dev only: file name -> body and type. */
  const served = new Map<string, { body: string | Uint8Array; mime: string }>();
  /** Dev only: module id -> the file names it registered. */
  const owned = new Map<string, Set<string>>();
  /** File name -> asset reference id, from the client build. */
  const refIds = new Map<string, string>();
  /** File name -> final file name, known once the client bundle is written. */
  const fileNames = new Map<string, string>();

  function clientUrl(
    ctx: { environment: { name: string } },
    name: string
  ): string | undefined {
    if (config.command !== "build" || ctx.environment.name === "client") {
      return;
    }

    const final = fileNames.get(name);

    return final === undefined ? undefined : `${config.base}${final}`;
  }

  function serve(
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction
  ): void {
    const { file: name } = splitQuery((req.url ?? "").replace(/^\//v, ""));
    const asset = served.get(name);

    if (!asset) {
      next();

      return;
    }

    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Cache-Control", "no-cache");
    res.end(
      asset.body instanceof Uint8Array ? Buffer.from(asset.body) : asset.body
    );
  }

  return {
    configure(resolved) {
      config = resolved;
    },

    clientUrl,

    replace(owner) {
      const previous = owned.get(owner);

      if (!previous) {
        return;
      }

      owned.delete(owner);

      for (const name of previous) {
        if (![...owned.values()].some((names) => names.has(name))) {
          served.delete(name);
        }
      }
    },

    url(ctx, owner, name, source, mime) {
      if (config.command !== "build") {
        served.set(name, { body: source, mime });
        owned.set(owner, (owned.get(owner) ?? new Set()).add(name));

        return JSON.stringify(`${prefix}${name}`);
      }

      const final = clientUrl(ctx, name);

      if (final !== undefined) {
        return JSON.stringify(final);
      }

      const ref = ctx.emitFile({ type: "asset", name, source });

      if (ctx.environment.name === "client") {
        refIds.set(name, ref);
      }

      return `import.meta.ROLLUP_FILE_URL_${ref}`;
    },

    generateBundle(ctx) {
      if (ctx.environment.name !== "client") {
        return;
      }

      for (const [name, ref] of refIds) {
        fileNames.set(name, ctx.getFileName(ref));
      }
    },

    configureServer(server) {
      server.middlewares.use(prefix, serve);
    },
  };
}
