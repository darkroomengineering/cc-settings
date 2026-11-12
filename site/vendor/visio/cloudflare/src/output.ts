import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertToWranglerConfig, InputConfigSchema } from "@cloudflare/config";
import type { WorkerConfig } from "@cloudflare/config";
import { patternSource } from "@visio/router/internal/vite";
import {
  buildDirs,
  buildPlugins,
  cachedPaths,
  compareVersions,
  copyClient,
  escapeRegExp,
  EXPIRATION,
  gated,
  hashedAsset,
  liveLists,
  installedVersion,
  NO_CAPTURE,
  recordCrawl,
  SECURITY_HEADERS,
  writeJson,
} from "visio/internal/deploy";
import type { DeployFacts, DeployOutput } from "visio/internal/deploy";
import { build, transformWithOxc } from "vite";
import type { Plugin } from "vite";

import type { WorkerOptions } from "./runtime.ts";

type Binding = Exclude<
  NonNullable<WorkerConfig["env"]>[string],
  false | null | undefined
>;

/** A Worker by its name: the schema the build parses with takes no Worker config. */
type ByName<B> = B extends { worker: unknown }
  ? Omit<B, "worker"> & { worker: string }
  : B;

type SiteBinding = ByName<
  Exclude<Binding, { type: "assets" | "json" | "secret" | "text" }>
>;

type WranglerBindings = Partial<ReturnType<typeof convertToWranglerConfig>>;

function ownerOf(type: Binding["type"]): string | undefined {
  switch (type) {
    case "assets": {
      return "The build binds the assets itself, as ASSETS.";
    }

    case "secret": {
      return "A secret goes in src/env.ts (the env skill).";
    }

    case "json":
    case "text": {
      return "A variable goes in src/env.ts (the env skill).";
    }

    default: {
      return undefined;
    }
  }
}

/** Cloudflare's own camelCase type; the build writes it in Wrangler's snake_case. */
export type Observability = NonNullable<WorkerConfig["observability"]>;

export interface CloudflareOptions {
  /** A path from the site's root. */
  observe?: string | undefined;
  bindings?: Readonly<Record<string, SiteBinding | false | null | undefined>>;
  /** Over `{ enabled: true }`. */
  observability?: Observability | undefined;
}

/** The aeo files `run_worker_first` sends to the Worker when the site has a hook. */
export const OBSERVED_FILES = ["/robots.txt", "/llms.txt", "/sitemap*.xml"];

/** The globs as the Worker matches them; Cloudflare's `*` crosses `/`. */
export function globsSource(globs: readonly string[]): string {
  return `^(?:${globs.map((glob) => escapeRegExp(glob).replaceAll("\\*", ".*")).join("|")})$`;
}

/** Names the Worker itself reads from `env`. */
const RESERVED_BINDINGS = new Set([
  "ASSETS",
  "SITE_PASSWORD",
  "VISIO_BYPASS_TOKEN",
]);

const BINDING_NAME = /^[A-Za-z_$][\w$]*$/u;

const SSR_CONDITIONS = [
  "workerd",
  "worker",
  "module",
  "node",
  "development|production",
];

/**
 * Workers Builds sets it to the name of the Worker in the dashboard. Wrangler
 * deploys under it whatever the config says, but warns when the two differ.
 */
export const NAME_VAR = "WRANGLER_CI_OVERRIDE_NAME";

/** The oldest Wrangler Cloudflare's docs name for Worker Previews ("Previews"). */
export const MIN_WRANGLER = "4.135.0";

/** The runtime visio is tested against: `process.env` filled from the vars, `ctx.exports`, Workers Cache. */
export const COMPATIBILITY_DATE = "2026-09-01";

export const OUT_DIR = "dist/cloudflare";

/** Workers Cache does not send it, unlike Vercel. */
const HEADERS = {
  ...SECURITY_HEADERS,
  "strict-transport-security": "max-age=63072000",
};

/** `_headers` takes at most this many rules. */
const MAX_RULES = 100;

const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/** The Worker's name from Workers Builds, or none: a deploy from a laptop gives it with `wrangler deploy --name`. */
export function workerName(
  env: Record<string, string | undefined>
): string | undefined {
  const name = env[NAME_VAR];

  if (!name) {
    return undefined;
  }

  if (!WORKER_NAME.test(name)) {
    throw new Error(
      `[@visio/cloudflare] ${NAME_VAR} is ${JSON.stringify(name)}, which is not a Worker name: lowercase letters, digits and dashes, at most 63.`
    );
  }

  return name;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/**
 * The headers of a file served before the Worker runs: the security headers
 * on every file, and `immutable` on the hashed ones.
 */
export function headersFile(
  assets: string,
  assetsFiles: readonly string[]
): string {
  const hashed = new RegExp(hashedAsset(`/${assets}`), "u");

  const lines = [
    "/*",
    ...Object.entries(HEADERS).map(([name, value]) => `  ${name}: ${value}`),
  ];

  lines.push(
    `/${assets}/*`,
    "  cache-control: public, max-age=31536000, immutable"
  );

  // A file there with no hash in its name may change under the same name.
  const plain = assetsFiles
    .values()
    .map((file) => `/${assets}/${file}`)
    .filter((file) => !hashed.test(file))
    .toArray();

  if (plain.length + 2 > MAX_RULES) {
    throw new Error(
      `[@visio/cloudflare] ${plain.length} files under ${assets}/ have no content hash in their name, more than the _headers file of a Worker can exempt from immutable caching. Let Vite name the files in build.assetsDir.`
    );
  }

  for (const file of plain) {
    lines.push(file, "  ! cache-control");
  }

  return `${lines.join("\n")}\n`;
}

async function strip(file: string, name: string): Promise<string> {
  const { code } = await transformWithOxc(readFileSync(file, "utf-8"), name, {
    lang: "ts",
  });

  return code;
}

async function bundleObserve(root: string, file: string, outDir: string) {
  await build({
    root,
    configFile: false,
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    plugins: [],
    environments: { ssr: { resolve: { conditions: SSR_CONDITIONS } } },
    ssr: { noExternal: true },
    build: {
      ssr: file,
      outDir,
      emptyOutDir: false,
      minify: false,
      rolldownOptions: {
        platform: "neutral",
        external: [/^node:/u, /^cloudflare:/u],
        output: { entryFileNames: "index.js" },
      },
    },
  });
}

function wranglerBindings(
  bindings: NonNullable<CloudflareOptions["bindings"]>
): WranglerBindings {
  for (const [name, value] of Object.entries(bindings)) {
    if (!BINDING_NAME.test(name) || RESERVED_BINDINGS.has(name)) {
      throw new Error(
        `[@visio/cloudflare] bindings: ${JSON.stringify(name)} cannot be a binding name: it must be a JavaScript name, and not ${[...RESERVED_BINDINGS].join(", ")}, which the Worker reads itself.`
      );
    }

    const owned = value ? ownerOf(value.type) : undefined;

    if (value && owned) {
      throw new Error(
        `[@visio/cloudflare] bindings: ${name} is a ${value.type} binding. ${owned}`
      );
    }
  }

  const env = Object.fromEntries(
    Object.entries(bindings).filter(([, value]) => value)
  );

  if (Object.keys(env).length === 0) {
    return {};
  }

  const parsed = InputConfigSchema.safeParse({
    worker: { name: "site", compatibilityDate: COMPATIBILITY_DATE, env },
  });

  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const name = issue?.path[2];

    throw new Error(
      `[@visio/cloudflare] bindings${name === undefined ? "" : `: ${String(name)}`}: ${issue?.message ?? parsed.error.message}. Build each binding with \`bindings\` from @visio/cloudflare.`
    );
  }

  const {
    name: _name,
    compatibility_date: _date,
    ...keys
  } = convertToWranglerConfig(parsed.data);

  return keys;
}

function observeFile(root: string, observe: string | undefined) {
  if (observe === undefined) {
    return;
  }

  const file = path.resolve(root, observe);

  if (!existsSync(file)) {
    throw new Error(
      `[@visio/cloudflare] observe: ${observe} is not a file under ${root}. Give the module's path from the site's root, such as "src/observe.ts".`
    );
  }

  return file;
}

/** The lists the Worker answers, cached by Render as a read, with their files gone: a file would win. */
function workerLists(assets: string, facts: DeployFacts) {
  const lists = liveLists(facts.lists?.());

  for (const list of lists.paths) {
    rmSync(path.join(assets, list.slice(1)));
  }

  return lists;
}

async function writeWorker(
  dir: string,
  ssrOut: string,
  root: string,
  observe: string | undefined,
  options: WorkerOptions,
  lists: string
) {
  if (observe) {
    await bundleObserve(root, observe, path.join(dir, "observe"));
  }

  cpSync(ssrOut, path.join(dir, "server"), { recursive: true });
  writeFileSync(
    path.join(dir, "runtime.js"),
    await strip(
      fileURLToPath(new URL("runtime.ts", import.meta.url)),
      "runtime.ts"
    )
  );

  // The entry only re-exports; the Worker needs the file that holds the code.
  const gate = fileURLToPath(
    new URL("gate.ts", import.meta.resolve("@visio/gate/internal/gate"))
  );

  writeFileSync(path.join(dir, "gate.js"), await strip(gate, "gate.ts"));
  writeFileSync(
    path.join(dir, "index.js"),
    [
      `import { WorkerEntrypoint } from 'cloudflare:workers';`,
      `import { gate } from './gate.js';`,
      `import { createWorker } from './runtime.js';`,
      `import { handleRequest } from './server/server.js';`,
      ...(observe ? [`import observe from './observe/index.js';`] : []),
      lists,
      `const { worker, Render: R } = createWorker(handleRequest, { WorkerEntrypoint, gate${observe ? ", observe" : ""} }, ${JSON.stringify(options)});`,
      // Workers looks for the class by its export name.
      `export class Render extends R {}`,
      `export default worker;`,
      "",
    ].join("\n")
  );
}

type SnakeCase<S extends string> = S extends `${infer Head}${infer Tail}`
  ? `${Head extends Lowercase<Head> ? Head : `_${Lowercase<Head>}`}${SnakeCase<Tail>}`
  : S;

/** Every key required, so a key that `@cloudflare/config` adds fails the typecheck until it is mapped here. */
type Snake<T> = { [K in keyof T & string as SnakeCase<K>]-?: T[K] };

type Logs = NonNullable<Observability["logs"]>;

type Traces = NonNullable<Observability["traces"]>;

/** `observability` as Wrangler reads it; `writeJson` drops the keys left undefined. */
export function wranglerObservability(observability: Observability = {}): Snake<
  Omit<Observability, "logs" | "traces">
> & {
  logs: Snake<Logs> | undefined;
  traces: Snake<Traces> | undefined;
} {
  const { logs, traces } = observability;

  return {
    enabled: observability.enabled ?? true,
    head_sampling_rate: observability.headSamplingRate,
    redact_query_string: observability.redactQueryString,
    issues: observability.issues,
    logs: logs && {
      enabled: logs.enabled,
      head_sampling_rate: logs.headSamplingRate,
      invocation_logs: logs.invocationLogs,
      persist: logs.persist,
      destinations: logs.destinations,
    },
    traces: traces && {
      enabled: traces.enabled,
      head_sampling_rate: traces.headSamplingRate,
      persist: traces.persist,
      destinations: traces.destinations,
    },
  };
}

/** The Wrangler config of the output; paths in it are relative to it. */
export function wranglerConfig(options: {
  name?: string | undefined;
  bypassToken: string;
  gate: boolean;
  observe?: boolean;
  bindings?: WranglerBindings;
  observability?: Observability | undefined;
}) {
  const config = {
    main: "worker/index.js",
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: ["nodejs_compat"],
    // The build already bundled the server; Wrangler uploads its modules as they are.
    no_bundle: true,
    find_additional_modules: true,
    base_dir: "worker",
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: {
      directory: "assets",
      binding: "ASSETS",
      // `/studio/index.html` would redirect to `/studio/`, which is no file.
      html_handling: "none",
      not_found_handling: "none",
      // The gate stands in front of the files too; a hook sees the aeo files.
      run_worker_first:
        options.observe && !options.gate ? OBSERVED_FILES : options.gate,
    },
    cache: { enabled: true },
    exports: {
      default: { type: "worker", cache: { enabled: false } },
      Render: { type: "worker", cache: { enabled: true } },
    },
    // Server code sets the bypass cookie with it when draft mode starts.
    vars: { VISIO_BYPASS_TOKEN: options.bypassToken },
    // Not in `previews`: a Preview must not send mail or write production's data.
    ...options.bindings,
    // Without it, a deploy drops the variables set in the dashboard.
    keep_vars: true,
    // A Preview falls back to it when `previews` has none.
    observability: wranglerObservability(options.observability),
    // Not `assets` or the compatibility keys: Wrangler reads those at the top level only.
    previews: { vars: { VISIO_BYPASS_TOKEN: options.bypassToken } },
  };

  return options.name ? { name: options.name, ...config } : config;
}

/**
 * A crawl integration that records pages and `prerendered()` reads, and the
 * plugins that build the server for workerd and write the Worker.
 */
export function cloudflareOutput(
  options: DeployFacts,
  site: CloudflareOptions = {}
): DeployOutput {
  const { crawl, integration } = recordCrawl("visio:cloudflare");
  // Before the build and the crawl, so a wrong binding fails at once.
  const bindings = wranglerBindings(site.bindings ?? {});
  let observe: string | undefined;

  const plugins: Plugin[] = [
    ...buildPlugins("Cloudflare"),
    {
      name: "visio:cloudflare:config",
      apply: "build",
      // In `config`, ahead of every `configEnvironment`: the Solid plugin adds
      // its own condition to these, and only when they are set.
      config: () => ({
        environments: {
          ssr: {
            resolve: { conditions: SSR_CONDITIONS },
            // `node` turns a CommonJS require() of a built-in into
            // `createRequire(import.meta.url)`, which throws when the Worker
            // starts: workerd leaves `import.meta.url` undefined. `neutral`
            // throws only when that require() runs.
            build: { rolldownOptions: { platform: "neutral" } },
          },
        },
      }),
    },
    {
      name: "visio:cloudflare:output",
      apply: "build",
      // Before the build and the crawl, so a wrong path fails at once.
      configResolved({ root }) {
        observe = observeFile(root, site.observe);
      },
      buildApp: {
        // After the crawl, which is `post` too and comes first.
        order: "post",
        async handler(builder) {
          const { root, logger } = builder.config;
          const wrangler = installedVersion(root, "wrangler");

          if (wrangler && compareVersions(wrangler, MIN_WRANGLER) < 0) {
            throw new Error(
              `[@visio/cloudflare] wrangler ${wrangler} is installed, but Worker Previews, which Workers Builds makes for every branch but production, need ${MIN_WRANGLER} or later. Run \`bun add -d wrangler@latest\`.`
            );
          }

          const gate = gated();
          const { assetsDir, clientOut, ssrOut } = buildDirs(builder);
          const out = path.join(root, OUT_DIR);
          rmSync(out, { recursive: true, force: true });

          const assets = path.join(out, "assets");
          copyClient(clientOut, assets);
          const lists = workerLists(assets, options);

          const own = files(assets);

          if (own.includes("_headers")) {
            throw new Error(
              `[@visio/cloudflare] public/_headers: the Cloudflare build writes the headers of the files itself. Delete public/_headers.`
            );
          }

          writeFileSync(
            path.join(assets, "_headers"),
            headersFile(
              assetsDir,
              own
                .filter((f) => f.startsWith(`${assetsDir}/`))
                .map((f) => f.slice(assetsDir.length + 1))
            )
          );

          const { pages, reads } = cachedPaths(crawl);
          // New every build, so a deploy ends every draft session.
          const bypassToken = randomBytes(32).toString("hex");
          await writeWorker(
            path.join(out, "worker"),
            ssrOut,
            root,
            observe,
            {
              bypassToken,
              expiration: EXPIRATION,
              reads: [...reads, ...lists.paths],
              patterns: (options.routes?.cached ?? []).map(patternSource),
              uncached: (options.routes?.uncached ?? []).map(patternSource),
              hashed: hashedAsset(`/${assetsDir}`),
              headers: HEADERS,
              studioPath: options.studioPath,
              gate: gate ? { open: options.open ?? [] } : undefined,
              observe: observe
                ? {
                    api: (options.routes?.api ?? []).map(patternSource),
                    files: globsSource(OBSERVED_FILES),
                  }
                : undefined,
            },
            lists.line
          );
          const name = workerName(process.env);
          writeJson(
            path.join(out, "wrangler.json"),
            wranglerConfig({
              name,
              bypassToken,
              gate,
              observe: Boolean(observe),
              bindings,
              observability: site.observability,
            })
          );
          // `wrangler deploy` in the root finds the config through it.
          writeJson(path.join(root, ".wrangler/deploy/config.json"), {
            configPath: path.relative(
              path.join(root, ".wrangler/deploy"),
              path.join(out, "wrangler.json")
            ),
          });

          if (!crawl.captured) {
            logger.warn(NO_CAPTURE);
          }

          if (!name && process.env.WORKERS_CI) {
            logger.warn(
              `[@visio/cloudflare] Workers Builds did not set ${NAME_VAR} for the build, so the config has no Worker name. Wrangler still deploys under the name from Workers Builds, but warns that the two differ.`
            );
          }

          logger.info(
            `[@visio/cloudflare] Cloudflare output: ${options.routes?.cached.length ?? 0} cached route(s), ${pages.length} crawled, ${reads.length} cached read(s)${gate ? ", behind the password gate" : ""} -> ${path.relative(root, out)}, ${name ? `Worker ${name}` : `no Worker name (Workers Builds sets ${NAME_VAR}; elsewhere deploy with \`wrangler deploy --name <worker>\`)`}`
          );
        },
      },
    },
  ];

  return { integration, plugins };
}
