import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { PrerenderIntegration } from "prerender-crawler/vite";

/** More rules, from `@visio/aeo` for the AI crawlers. */
export interface RobotsRules {
  /** Lines added to the `User-agent: *` group. */
  all: readonly string[];
  /** Groups after it, each from its `User-agent` lines. */
  groups: readonly (readonly string[])[];
}

export interface RobotsOptions {
  /** The public origin, for the absolute sitemap URL. The sitemap's own `hostname`. */
  hostname?: string | undefined;
  rules?: RobotsRules | undefined;
}

export function robots(options: RobotsOptions = {}): PrerenderIntegration {
  return {
    name: "visio:robots",
    teardown(context) {
      if (existsSync(path.join(context.outDir, "robots.txt"))) {
        return;
      }

      context.emitFile({
        filename: "robots.txt",
        contents: robotsTxt(context.files, options),
      });
    },
  };
}

/** The file's text; exported for tests. */
export function robotsTxt(
  files: readonly { filename: string }[],
  { hostname, rules }: RobotsOptions
): string {
  const groups = [
    ["User-agent: *", "Allow: /", ...(rules?.all ?? [])],
    ...(rules?.groups ?? []),
  ];

  const map = files.find((f) =>
    /(?:^|\/)sitemap[^\/]*\.xml$/v.test(f.filename)
  );

  if (map && hostname) {
    groups.push([`Sitemap: ${new URL(map.filename, hostname).href}`]);
  }

  return `${groups.map((group) => group.join("\n")).join("\n\n")}\n`;
}

/** The dev server's `/robots.txt`; `publicDir` is empty when the site has none. `rules` is read per request, as the crawl reads them. */
export function robotsMiddleware(
  publicDir: string,
  rules?: () => RobotsRules | undefined
) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void => {
    if (req.url?.split("?")[0] !== "/robots.txt") {
      return next();
    }

    if (publicDir && existsSync(path.join(publicDir, "robots.txt"))) {
      return next();
    }

    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(robotsTxt([], { rules: rules?.() }));
  };
}
