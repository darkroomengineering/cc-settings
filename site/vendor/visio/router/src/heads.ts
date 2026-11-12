import type { PrerenderIntegration } from "prerender-crawler/vite";

/**
 * `og:title` as the head registry writes it. `useRouteHead()` registers it
 * for every page, and a tag written in the document shell has no `data-dh`.
 */
const ROUTE_HEAD = /<meta\b[^>]*\bdata-dh="meta:property:og:title"/v;

export function hasRouteHead(html: string): boolean {
  return ROUTE_HEAD.test(html);
}

export function headGuard(): PrerenderIntegration {
  return {
    name: "visio:heads",
    teardown(context) {
      const missing = context.pages
        .filter((page) => !page.redirect && !hasRouteHead(page.html))
        .map((page) => page.path);

      if (!missing.length) {
        return;
      }

      throw new Error(
        `[@visio/router] ${missing.length} page(s) were written without their route head, so they kept the document's fallback title:\n${missing.map((p) => `  ${p}`).join("\n")}\n` +
          "On the server, a meta() that throws, or a preload it reads that rejects, costs the page its head tags; open the page on the dev server for the error. With every page listed, app.tsx does not render the Router from src/routes.ts (the router skill, .claude/skills/router/SKILL.md)."
      );
    },
  };
}
