import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const SERVER_DIST =
  /[\\/]@solidjs[\\/]web[\\/]dist[\\/]server(?:\.dev|\.observe)?\.js$/u;

// The thenable's flush in @solidjs/web 2.0.0-rc.20. It resolves the root
// holes without making its render current again; `pipe()` does that first.
const BROKEN = "2.0.0-rc.20";

const THEN_FLUSH =
  /(?<head>scheduleFlush\(\(\) => \{\s*if \(dead\) return;)(?<tail>\s*try \{\s*if \(blockingPromises\.size !== lastBlockingSize \|\| !resolveRootHoles\(\))/u;

/** Makes Solid's `async` render mode safe with other renders in flight (DESIGN.md, In-order pages). */
export function asyncRender(): Plugin {
  let warned = false;

  return {
    name: "visio:async-render",
    applyToEnvironment: (environment) =>
      environment.config.consumer === "server",
    transform: {
      filter: { id: SERVER_DIST, code: "resolveRootHoles" },
      handler(code, id) {
        const patched = code.replace(
          THEN_FLUSH,
          "$<head> sharedConfig.context = context;$<tail>"
        );

        if (patched !== code) {
          return { code: patched, map: null };
        }

        const file = path.resolve(path.dirname(id), "../package.json");

        // SAFETY: every npm package.json has a string version.
        const { version } = JSON.parse(readFileSync(file, "utf-8")) as {
          version: string;
        };

        if (version === BROKEN) {
          this.error(
            `[visio] ${id} does not read as visio:async-render expects, so the crawl's concurrent renders would mix their <Loading> boundaries. Report it to visio, with the @solidjs/web version.`
          );
        }

        if (!warned) {
          warned = true;
          this.warn(
            `[visio] @solidjs/web ${version}: visio:async-render found no code to fix, the fix for ${BROKEN} that keeps the crawl's concurrent renders apart. Run visio's test/async-render.test.ts on this version, and remove the plugin if it passes.`
          );
        }
      },
    },
  };
}
