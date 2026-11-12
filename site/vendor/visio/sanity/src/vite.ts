import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import {
  DEFAULT_API_PATH,
  DEFAULT_STUDIO_PATH,
  STUDIO_DIR,
} from "./constants.ts";
import { stegaCheck } from "./stega-check.ts";
import { cachedStudio, keepStudio, studioKey } from "./studio-cache.ts";
import { checkStudio, isStudioConfigFile } from "./studio-check.ts";
import { checkLanguages, LANGUAGES_FILE } from "./studio-languages.ts";
import type { SiteLanguagesOf } from "./studio-languages.ts";
import {
  deploying,
  nodeBinary,
  startStudio,
  studioForServer,
  studioIcons,
  studioMiddleware,
  unsetProject,
  unsetRevalidateSecret,
  unsetStudioProject,
} from "./studio.ts";

/** Where the site serves the Studio and the draft mode and publish routes. */
export interface SanityPaths {
  studio: string;
  api: string;
}

function inside(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`);
}

const PATH_RE = /^\/[\w\-.\/~]*[\w\-~]$/v;

/** The Studio's paths with the defaults filled in, checked; `undefined` with the Studio off. */
export function sanityPaths(
  option: boolean | { path?: string; api?: string } | undefined
): SanityPaths | undefined {
  if (!option) {
    return undefined;
  }

  const own = option === true ? {} : option;

  const paths = {
    studio: own.path ?? DEFAULT_STUDIO_PATH,
    api: own.api ?? DEFAULT_API_PATH,
  };

  for (const [key, value] of [
    ["path", paths.studio],
    ["api", paths.api],
  ] as const) {
    if (!PATH_RE.test(value)) {
      throw new Error(
        `[@visio/sanity] studio.${key} is ${JSON.stringify(value)}. Give a path from the root without a trailing slash, such as "${key === "path" ? DEFAULT_STUDIO_PATH : DEFAULT_API_PATH}".`
      );
    }
  }

  if (inside(paths.studio, paths.api) || inside(paths.api, paths.studio)) {
    throw new Error(
      `[@visio/sanity] studio.path (${paths.studio}) and studio.api (${paths.api}) overlap. Give each its own path.`
    );
  }

  return paths;
}

/**
 * What the Studio's own config reads (`studio/sanity.cli.ts`, `studio/sanity.config.ts`).
 * Sanity only bundles `SANITY_STUDIO_` variables, so the site's pair is passed under that prefix.
 */
export function studioEnv(
  paths: SanityPaths,
  site: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (site.SANITY_PROJECT_ID) {
    env.SANITY_STUDIO_PROJECT_ID = site.SANITY_PROJECT_ID;
  }

  if (site.SANITY_DATASET) {
    env.SANITY_STUDIO_DATASET = site.SANITY_DATASET;
  }

  env.SANITY_STUDIO_BASE_PATH = paths.studio;
  env.SANITY_STUDIO_API_PATH = paths.api;

  return env;
}

const STUDIO_PORT = 3333;

/**
 * Typegen inside the dev server: one `Typegen` kept between changes, every
 * step queued behind the last so writes never interleave. A warning repeats
 * only when the set of errors changes.
 */
async function keepTypesCurrent(
  server: ViteDevServer,
  root: string,
  studioDir: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const { Typegen } = await import("./typegen.ts");
  const typegen = new Typegen(root, studioDir);
  const { logger } = server.config;
  let reported = "";
  let unset: string | undefined;
  let queue = Promise.resolve();

  async function apply(step: () => Promise<void> | void) {
    try {
      await step();
      const result = await typegen.write();

      const errors = result.errors
        .map((e) => `[@visio/sanity] Typegen: ${e}`)
        .join("\n");

      if (errors && errors !== reported) {
        logger.warn(errors);
      }

      reported = errors;
      // Once, when the first query arrives in a site without a project.
      const warning = unsetProject(env, result.queries);

      if (warning && !unset) {
        logger.warn(warning);
      }

      unset = warning;
    } catch (error) {
      // The errors before this one show again once it is fixed.
      reported = "";
      logger.warn(
        `[@visio/sanity] Typegen: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  async function after(
    previous: Promise<void>,
    step: () => Promise<void> | void
  ) {
    await previous;
    await apply(step);
  }

  function run(step: () => Promise<void> | void) {
    queue = after(queue, step);
  }

  run(async () => {
    await typegen.loadSchema();
    typegen.scan();
  });

  let schemaTimer: ReturnType<typeof setTimeout> | undefined;
  server.watcher.add(studioDir);
  server.watcher.on("all", (_event, file) => {
    if (file.startsWith(studioDir + path.sep)) {
      if (
        /[\\\/](?:node_modules|dist|\.sanity)[\\\/]|schema\.json$/v.test(file)
      ) {
        return;
      }

      // An editor often writes several files at once; reload the schema once.
      clearTimeout(schemaTimer);
      schemaTimer = setTimeout(() => run(() => typegen.loadSchema()), 100);
    } else if (typegen.isQueryFile(file)) {
      run(() => typegen.update(file));
    }
  });
}

/** `sanity build` into a directory of its own, with its output kept for the log. */
function sanityBuild(bin: string, cwd: string, env: NodeJS.ProcessEnv) {
  const out = mkdtempSync(path.join(tmpdir(), "visio-studio-"));

  const child = spawn(nodeBinary(), [bin, "build", out, "--yes"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));

  function stop() {
    child.kill();
  }

  process.once("exit", stop);

  const done = Promise.withResolvers<{
    ok: boolean;
    out: string;
    log: string;
  }>();

  child.once("close", (code) => {
    process.off("exit", stop);
    done.resolve({ ok: code === 0, out, log });
  });

  return { done: done.promise, stop };
}

/** Removes the output of a stopped `sanity build` once it has exited. */
async function removeOutput(done: Promise<{ out: string }>) {
  const { out } = await done;
  rmSync(out, { recursive: true, force: true });
}

/** The modules of the visual editing overlay (`<VisualEditing />`). */
const OVERLAY = /[\\\/]@sanity[\\\/]visual-editing-standalone[\\\/]/v;
const SIZE_WARNING = "Some chunks are larger than";

/**
 * Drops Vite's chunk size warning when every oversized chunk is the visual
 * editing overlay (React inside, draft sessions only).
 */
function overlayChunk(): Plugin {
  let quiet = false;

  return {
    name: "visio:sanity:overlay-chunk",
    apply: "build",
    configEnvironment(name, config) {
      if (name !== "client") {
        return;
      }

      const own = config.build?.rolldownOptions?.onLog;

      return {
        build: {
          rolldownOptions: {
            onLog(level, log, handler) {
              if (quiet && log.message.includes(SIZE_WARNING)) {
                return;
              }

              if (own) {
                own(level, log, handler);
              } else {
                handler(level, log);
              }
            },
          },
        },
      };
    },
    generateBundle(_, bundle) {
      if (this.environment.name !== "client") {
        return;
      }

      const limit = this.environment.config.build.chunkSizeWarningLimit * 1000;

      const large = Object.values(bundle).filter(
        (chunk) => chunk.type === "chunk" && chunk.code.length > limit
      );

      quiet =
        large.length > 0 &&
        large.every(
          (chunk) =>
            chunk.type === "chunk" &&
            chunk.moduleIds.every(
              (id) => id.startsWith("\0") || OVERLAY.test(id)
            )
        );
    },
  };
}

/**
 * The Studio build in flight, by site root. Module scope: a build resolves
 * each environment's plugins afresh, and the one started with the client
 * finishes with the server.
 */
const builds = new Map<
  string,
  | { cached: string }
  | (ReturnType<typeof sanityBuild> & { key: string | undefined })
>();

/** An import of the overlay from the site's own source. */
const OVERLAY_IMPORT =
  /import\s*\{[^\}]*\bVisualEditing\b[^\}]*\}\s*from\s*['"]@visio\/sanity['"]/v;

const NO_OVERLAY =
  "[@visio/sanity] The Studio is on, but nothing renders <VisualEditing /> from @visio/sanity, so the Presentation tool shows no overlay and the page does not follow the Studio. Render it once inside the router, in app.tsx, with the site's own controls for draft mode (exit and overlay) (.claude/skills/sanity/SKILL.md, Preview).";

/** Stops the Studio build of a failed site build and removes its output. */
function abortStudio(root: string) {
  const build = builds.get(root);

  if (!build) {
    return;
  }

  builds.delete(root);

  if ("cached" in build) {
    return;
  }

  build.stop();
  removeOutput(build.done);
}

function copyStudio(from: string, target: string, base: string) {
  cpSync(from, target, { recursive: true });
  const index = path.join(target, "index.html");
  writeFileSync(index, studioIcons(readFileSync(index, "utf-8"), base));
}

/** Typegen, with the Studio served or not: on every save in dev, once per build. */
export function sanityTypes(): Plugin {
  let root = process.cwd();

  function studioDir() {
    return path.resolve(root, STUDIO_DIR);
  }

  return {
    name: "visio:sanity-types",
    configResolved(config) {
      ({ root } = config);
    },
    async configureServer(server) {
      await keepTypesCurrent(server, root, studioDir(), process.env);
    },
    // Types are written once per build; CI diffs them, and an untypable query fails here.
    async buildStart() {
      if (
        this.environment.name !== "client" ||
        this.environment.mode !== "build"
      ) {
        return;
      }

      const { typegen } = await import("./typegen.ts");
      const result = await typegen(root, studioDir());

      if (result.errors.length) {
        this.error(
          `[@visio/sanity] Typegen:\n${result.errors.map((e) => `  ${e}`).join("\n")}`
        );
      }

      // A warning, not an error: a host can set the project at runtime only.
      const unset = unsetProject(process.env, result.queries);

      if (unset) {
        this.warn(unset);
      }
    },
  };
}

/**
 * The Studio plugin and the overlay's chunk rule. `languages` gives
 * `languages` of the extension of `@visio/i18n`, when the site has it.
 */
export function studio(
  paths: SanityPaths,
  languages?: () => SiteLanguagesOf | undefined
): Plugin[] {
  return [studioPlugin(paths, languages), overlayChunk()];
}

function studioPlugin(
  paths: SanityPaths,
  languages: (() => SiteLanguagesOf | undefined) | undefined
): Plugin {
  let root = process.cwd();
  let overlay = false;
  let written = false;
  let studioCache = "";

  function studioDir() {
    return path.resolve(root, STUDIO_DIR);
  }

  function sanityBin(): string {
    const bin = path.join(studioDir(), "node_modules", ".bin", "sanity");

    if (!existsSync(bin)) {
      throw new Error(
        `[@visio/sanity] No Sanity CLI in ${studioDir()}. The Studio lives next to the site, in ${STUDIO_DIR}; run \`bun install\` at the workspace root.`
      );
    }

    return bin;
  }

  return {
    name: "visio:studio",
    config(user, env) {
      root = path.resolve(user.root ?? process.cwd());

      // The runtime code reads the paths from these (constants.ts).
      const define = {
        "import.meta.env.VISIO_SANITY_STUDIO": JSON.stringify(paths.studio),
        "import.meta.env.VISIO_SANITY_API": JSON.stringify(paths.api),
      };

      // Dev only: `vite preview` inherits `server.proxy`, and it serves the built copy.
      if (env.command !== "serve" || env.isPreview) {
        return { define };
      }

      return {
        define,
        server: {
          // `ws` for the Studio's own hot reload.
          proxy: {
            [`${paths.studio}/`]: {
              target: `http://localhost:${STUDIO_PORT}`,
              ws: true,
            },
          },
        },
      };
    },
    configResolved(config) {
      studioCache = path.join(config.cacheDir, "visio-studio");
    },
    configureServer(server) {
      server.middlewares.use(studioMiddleware(paths.studio));
      // Before the SSR render, which Solid's plugin adds after Vite's own middlewares.
      server.middlewares.use(stegaCheck(server.config.logger));
      let reported = "";

      function check() {
        const findings = [
          ...checkStudio(studioDir()),
          ...checkLanguages(studioDir(), root, languages?.()),
        ]
          .map((f) => f.message)
          .join("\n");

        if (findings && findings !== reported) {
          server.config.logger.warn(findings);
        }

        reported = findings;
      }

      check();

      const watched = new Set([
        path.join(studioDir(), "package.json"),
        path.join(studioDir(), LANGUAGES_FILE),
        path.join(root, "src", "routes.ts"),
      ]);

      server.watcher.on("all", (_event, file) => {
        if (isStudioConfigFile(file) || watched.has(file)) {
          check();
        }
      });
      const command = nodeBinary();
      const args = [sanityBin(), "dev", "--port", String(STUDIO_PORT)];
      studioForServer(
        server.httpServer,
        () =>
          startStudio(
            command,
            args,
            studioDir(),
            STUDIO_PORT,
            studioEnv(paths, process.env)
          ),
        (reason) =>
          server.config.logger.error(
            `[@visio/sanity] The Studio did not start: ${String(reason)}`
          )
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        studioMiddleware(paths.studio, `${paths.studio}/index.html`)
      );
    },
    // The Studio builds alongside the site.
    buildStart() {
      written = false;

      // The dev server calls this too: there `sanity dev` does the work.
      if (
        this.environment.name !== "client" ||
        this.environment.mode !== "build"
      ) {
        return;
      }

      if (!process.env.SANITY_PROJECT_ID) {
        const message = unsetStudioProject(paths.studio);

        // Only a deployment needs the Studio to work: CI and a first build have no project yet.
        if (deploying(process.env)) {
          this.error(message);
        }

        this.warn(message);
      }

      const noSecret = unsetRevalidateSecret(process.env);

      if (noSecret) {
        this.warn(noSecret);
      }

      for (const finding of [
        ...checkStudio(studioDir()),
        ...checkLanguages(studioDir(), root, languages?.()),
      ]) {
        if (finding.level === "error") {
          this.error(finding.message);
        } else {
          this.warn(finding.message);
        }
      }

      const bin = sanityBin();
      const env = studioEnv(paths, process.env);
      // The site's .env files reach the Studio too: `studio/sanity.cli.ts` loads them.
      const key = studioKey(studioDir(), { ...process.env, ...env });
      const cached = key && cachedStudio(studioCache, key);
      builds.set(
        root,
        cached ? { cached } : { ...sanityBuild(bin, studioDir(), env), key }
      );
    },
    transform: {
      // `u`, not `v`: Rolldown's hook filters reject a `v` RegExp.
      filter: { id: /\.[jt]sx?$/u, code: "VisualEditing" },
      handler(code, id) {
        if (
          this.environment.name === "client" &&
          id.startsWith(path.join(root, "src"))
        ) {
          overlay ||= OVERLAY_IMPORT.test(code);
        }

        return null;
      },
    },
    generateBundle() {
      if (
        this.environment.name === "client" &&
        this.environment.mode === "build" &&
        !overlay
      ) {
        this.error(NO_OVERLAY);
      }
    },
    buildEnd(error) {
      if (error) {
        abortStudio(root);
      }
    },
    // An error after buildEnd (NO_OVERLAY above, another plugin's
    // renderChunk) skips writeBundle and reaches no hook with the error;
    // closeBundle still runs.
    closeBundle() {
      if (!written) {
        abortStudio(root);
      }
    },
    // After the last environment is written: the client's output is final by
    // then (Vite empties it first), and the crawl never renders the Studio's paths.
    writeBundle: {
      order: "post",
      async handler() {
        written = true;
        const { environments } = this.environment.getTopLevelConfig();
        const last = "ssr" in environments ? "ssr" : "client";
        const build = builds.get(root);

        if (this.environment.name !== last || !build) {
          return;
        }

        builds.delete(root);
        const client = environments.client?.build.outDir;

        if (client === undefined) {
          throw new Error(
            "[@visio/sanity] The build has no client environment."
          );
        }

        const target = path.resolve(root, client, paths.studio.slice(1));
        const shown = path.join(client, paths.studio.slice(1));
        rmSync(target, { recursive: true, force: true });

        if ("cached" in build) {
          copyStudio(build.cached, target, paths.studio);
          this.environment.logger.info(
            `[@visio/sanity] Studio unchanged, copied into ${shown}`
          );

          return;
        }

        const { ok, out, log } = await build.done;

        if (!ok) {
          rmSync(out, { recursive: true, force: true });
          this.error(
            `[@visio/sanity] \`sanity build\` in ${STUDIO_DIR} failed:\n${log}`
          );
        }

        copyStudio(out, target, paths.studio);

        if (build.key) {
          try {
            keepStudio(studioCache, build.key, out);
          } catch (error) {
            this.warn(
              `[@visio/sanity] The Studio build was not cached: ${error}`
            );
          }
        }

        rmSync(out, { recursive: true, force: true });
        this.environment.logger.info(
          `[@visio/sanity] Studio built into ${shown}`
        );
      },
    },
  };
}
