import type { Plugin } from "vite";

import { pagePath, wantsMarkdown } from "./paths.ts";

export { llms, llmsPages } from "./llms.ts";

export { MARKDOWN, markdownPath, pagePath, wantsMarkdown } from "./paths.ts";

export { type AeoOptions, robotsRules } from "./robots.ts";

// The Solid plugin's dev server renders only a request whose Accept takes
// HTML, and decides it before any middleware runs.
export function aeoDev(): Plugin {
  return {
    name: "visio:aeo:dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }

        const url = new URL(req.url ?? "/", "http://localhost");
        const accept = req.headers.accept ?? null;

        if (pagePath(url.pathname) !== undefined) {
          req.headers.accept = "text/html";
        } else if (wantsMarkdown(url, accept)) {
          req.headers.accept = `text/html, ${accept}`;
        }

        next();
      });
    },
  };
}
