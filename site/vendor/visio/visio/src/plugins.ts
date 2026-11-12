import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import type { Options as SolidOptions } from "@solidjs/vite-plugin";
import { aeoDev, llms, robotsRules } from "@visio/aeo/internal/vite";
import { CLIENT_PREFIX, env as envPlugins } from "@visio/env/internal/vite";
import { images, svg } from "@visio/image-optimizer/internal/vite";
import { router } from "@visio/router/internal/vite";
import type {
  CrawlWiring,
  ReservedPath,
  RouteFacts,
} from "@visio/router/internal/vite";
import { styling } from "@visio/styling/internal/vite";
import type { PrerenderIntegration } from "prerender-crawler/vite";
import type { Plugin, UserConfig } from "vite";

import { asyncRender } from "./async-render.ts";
import { escapeRegExp, previewBranch, PRODUCTION_BRANCH } from "./deploy.ts";
import type { DeployFacts, Deployment } from "./deploy.ts";
import { icons } from "./icons.ts";
import type { SiteOptions, VisioExtension, VisioOptions } from "./index.ts";
import { listsIntegration } from "./lists-build.ts";
import type { ListsHolder } from "./lists-build.ts";
import { prerenderEnv } from "./prerender-env.ts";
import { checkSolidVersions, installedVersion } from "./versions.ts";

/**
 * `visio()`'s options with the parts a test leaves out. A site never gets
 * these: `visio()` takes `VisioOptions` only.
 */
export interface InternalOptions extends Omit<VisioOptions, "deploy"> {
  /** Without one, no output is written. */
  deploy?: Deployment | undefined;
  styling?: false;
  images?: false;
  svg?: false;
  solid?: false;
}

/** Fixed: `src/env.ts` names its client vars with it. */
export const ENV_PREFIX = CLIENT_PREFIX;

/** The site's options and the deployment's facts from the env, filled in once Vite knows the mode. */
export interface SiteFacts extends SiteOptions {
  url?: string | undefined;
  indexable: boolean;
}

/** `PUBLIC_SITE_URL` and `PUBLIC_SITE_INDEXABLE`, from the env files and the shell. */
export function siteFromEnv(
  env: Readonly<Record<string, string | undefined>>
): Omit<SiteFacts, keyof SiteOptions> {
  const indexable = env.PUBLIC_SITE_INDEXABLE;

  if (
    indexable !== undefined &&
    indexable !== "" &&
    indexable !== "true" &&
    indexable !== "false"
  ) {
    throw new Error(
      `[visio] PUBLIC_SITE_INDEXABLE is ${JSON.stringify(indexable)}. Set it to 'true' only for the deployment search engines may index, and leave it unset everywhere else.`
    );
  }

  return {
    url: env.PUBLIC_SITE_URL || undefined,
    indexable: indexable === "true",
  };
}

/**
 * What the crawl gets from the site facts: the sitemap needs the origin and
 * the go-ahead, read when the crawl ends, and a link to a path an extension
 * serves (the Studio) is not a page to render.
 */
export function crawlWiring(
  site: SiteFacts,
  served: readonly string[] = [],
  aeo?: VisioOptions["aeo"]
): CrawlWiring {
  const wiring: CrawlWiring = {
    hostname: () => (site.indexable ? site.url : undefined),
    robots: () => (site.indexable ? robotsRules(aeo) : undefined),
  };

  if (served.length > 0) {
    wiring.filter = (p) => !served.some((base) => under(p, base));
  }

  return wiring;
}

function under(p: string, base: string) {
  return p === base || p.startsWith(`${base}/`);
}

function firstExisting(
  root: string,
  files: readonly string[]
): string | undefined {
  return files.find((f) => existsSync(path.resolve(root, f)));
}

/** The middleware chain, as the Solid plugin wants it: inside the root (`virtual:visio/middleware`). */
const CHAIN = "node_modules/visio/src/chain.ts";
const CHAIN_ID = "virtual:visio/middleware";

/** The configure module, which registers the site's router (`virtual:visio/router`). */
const CONFIGURE = "node_modules/visio/src/server-config.ts";
const ROUTER_ID = "virtual:visio/router";

const ROUTES = "src/routes.ts";

/** Where the smoke run finds the paths the site serves itself. */
export const PATHS_FILE = ".visio/paths.json";

type SolidStart = Exclude<SolidOptions["start"], boolean | undefined>;

type SolidConfig = Partial<SolidOptions> & {
  start: SolidStart;
  serverFunctions: Exclude<
    SolidOptions["serverFunctions"],
    boolean | undefined
  >;
};

/**
 * `solid()` options for a visio site. The site's files are found under
 * `root`. Without it, `visio:config` finds them once Vite knows the root:
 * the Solid plugin reads them from these objects in its own config hooks,
 * which run later.
 */
export function solidOptions(root?: string, chain?: Chain): SolidConfig {
  const options: SolidConfig = {
    ssr: true,
    diagnostics: true,
    start: {},
    serverFunctions: {},
    // @visio/env types and loads the env, from src/env.ts.
    env: false,
  };

  if (root !== undefined) {
    findSolidFiles(options, root, chain ?? {});
  }

  return options;
}

/** What `virtual:visio/middleware` and `virtual:visio/router` import from the site. */
interface Chain {
  root?: string;
  /** The site's own middleware, run after the extensions' and before the API routes. */
  site?: string;
  /** The extensions' middleware, such as Sanity's draft mode and publish routes. */
  extensions?: readonly string[];
  /** The deployment's middleware, such as Vercel's cache on the request event, ahead of everything that tags or purges. */
  deploy?: string | undefined;
}

/** `llms.txt` of `@visio/aeo`, for an indexable build only, as the sitemap. */
export function llmsFile(site: SiteFacts) {
  return llms(() =>
    site.indexable ? { hostname: site.url, name: site.name } : undefined
  );
}

function findSolidFiles(
  { start, serverFunctions }: SolidConfig,
  root: string,
  chain: Chain
) {
  const own = firstExisting(root, [
    "src/server-config.ts",
    "src/server-config.js",
  ]);

  if (own) {
    throw new Error(
      `[visio] ${own}: visio() registers the router of src/routes.ts as the single-flight collector itself. Delete ${own}.`
    );
  }

  if (!existsSync(path.resolve(root, ROUTES))) {
    throw new Error(
      `[visio] ${ROUTES} is missing. It is the route table: \`export const routes = defineRoutes([...])\` from @visio/router, ending with \`export const { Router, paths } = routes\`.`
    );
  }

  shellFiles(start, root);
  chain.root = root;
  chain.site = firstExisting(root, ["src/middleware.ts", "src/middleware.js"]);
  // In place: the Solid plugin reads these same objects later, in its own config hooks.
  start.middleware = `./${CHAIN}`;
  serverFunctions.serverSetup = `./${CONFIGURE}`;
}

/** `existsSync` matches either case on macOS, so the names come from the folder. */
function shellFiles(start: SolidStart, root: string) {
  const src = path.join(root, "src");
  const names = existsSync(src) ? readdirSync(src) : [];
  const pascal = names.find((name) => /^(?:App|Document)\.[jt]sx$/u.test(name));

  if (pascal) {
    throw new Error(
      `[visio] [SHELL_NAME_CASE] src/${pascal}: file names are kebab-case. Rename it to src/${pascal.toLowerCase()}.`
    );
  }

  const app = names.find((name) => /^app\.[jt]sx$/u.test(name));
  const document = names.find((name) => /^document\.[jt]sx$/u.test(name));

  if (app) {
    start.app = `./src/${app}`;
  }

  if (document) {
    start.document = `./src/${document}`;
  }
}

/**
 * Pre-bundled on a fresh cache. Only the pre-bundled `@solidjs/prerender`
 * imports `@solidjs/web/server-functions`, so the scanner misses it and Vite
 * reloads mid-hydration. `@solidjs/router` stays out: the Solid plugin
 * compiles its JSX source. Missing packages are dropped.
 */
const RUNTIME_DEPS = [
  "solid-js",
  "@solidjs/web",
  "@solidjs/web/server-functions",
  "@solidjs/prerender",
];

/** Server-only dependencies the dev scan would pre-bundle for the browser (DESIGN.md, "What `visio:config` sets"). */
const NOT_IN_BROWSER = ["oxc-parser", "@vercel/functions"];

/** The browser's uncaught errors, rejections, `console.error` and `console.warn`, printed by the dev server. */
const FORWARD_CONSOLE = { unhandledErrors: true, logLevels: ["error", "warn"] };

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");

  return (
    specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)
  ).join("/");
}

const told = new Set<string>();

/** The Vite settings a visio site needs, applied unless the site set them itself. */
function configPlugin(
  site: SiteFacts,
  solidConfig: SolidConfig | undefined,
  served: readonly string[],
  chain: Chain
): Plugin {
  let notice: string | undefined;

  return {
    name: "visio:config",
    // `pre`, like `solid()`: config hooks run in plugin order after that sort,
    // and the Solid plugin has to see `optimizeDeps.exclude` when it crawls
    // the workspace packages, or it lists their tools for pre-bundling anyway.
    enforce: "pre",
    config(user): UserConfig {
      if (user.envPrefix !== undefined && user.envPrefix !== ENV_PREFIX) {
        throw new Error(
          `[visio] envPrefix is ${JSON.stringify(user.envPrefix)}, but a visio site exposes ${ENV_PREFIX} variables to the client, and src/env.ts names them so. Remove envPrefix from vite.config.ts.`
        );
      }

      checkForwardConsole(user);
      const root = path.resolve(user.root ?? process.cwd());
      Object.assign(
        site,
        // @visio/env filled process.env from the mode's file, ahead of this plugin.
        siteFromEnv(process.env)
      );
      const branch = previewBranch(process.env);

      if (site.indexable && branch) {
        site.indexable = false;
        notice = `[visio] PUBLIC_SITE_INDEXABLE is true, but this is a preview build of branch ${JSON.stringify(branch)}, not of the production branch ${JSON.stringify(process.env.VISIO_PRODUCTION_BRANCH || PRODUCTION_BRANCH)}: no sitemap, no llms.txt, no AI crawler rules in robots.txt, and noindex on every page. Set VISIO_PRODUCTION_BRANCH in the build variables when production builds from another branch.`;
      }

      if (solidConfig) {
        findSolidFiles(solidConfig, root, chain);
      }

      const include = RUNTIME_DEPS.filter(
        (dep) => installedVersion(root, packageName(dep)) !== undefined
      );

      const config: UserConfig = {
        envPrefix: ENV_PREFIX,
        // Linked from another checkout, the @visio packages would resolve Solid
        // and Vite from their own node_modules: two Solid runtimes, every context
        // read empty. Force the app's copies.
        resolve: {
          dedupe: ["solid-js", "@solidjs/web", "@solidjs/router", "vite"],
        },
        // In dev an external package imports solid-js through Node and gets the
        // production server build while the app runs the dev build.
        ssr: { noExternal: ["@solidjs/prerender"] },
        // Vite merges the lists with the site's own, so a site only adds to them.
        optimizeDeps: { include, exclude: NOT_IN_BROWSER },
        build: buildDefaults(user),
        define: siteDefines(site),
      };

      // Vite forwards the browser's errors to the terminal only when it
      // detects an agent. An agent reads the terminal, not the console.
      if (user.server?.forwardConsole === undefined) {
        config.server = { forwardConsole: FORWARD_CONSOLE };
      }

      return config;
    },
    // Before any file is compiled, so a wrong Solid fails here and says so.
    configResolved(config) {
      // The build resolves the config three times, each with a new visio().
      if (notice && config.command === "build" && !told.has(notice)) {
        told.add(notice);
        config.logger.warn(notice);
      }

      for (const warning of checkSolidVersions(config.root)) {
        config.logger.warn(warning);
      }

      if (config.command === "serve") {
        writePaths(config.root, served);
      }
    },
  };
}

function checkForwardConsole(user: UserConfig) {
  const forward = user.server?.forwardConsole;

  if (
    forward === false ||
    (forward !== undefined &&
      forward !== true &&
      "enabled" in forward &&
      forward.enabled === false)
  ) {
    throw new Error(
      "[visio] server.forwardConsole turns off the browser console in the dev server's terminal, but an agent reads the terminal, not the browser. Remove server.forwardConsole from vite.config.ts."
    );
  }
}

/** The build settings the site left unset. */
function buildDefaults(user: UserConfig) {
  const build: NonNullable<UserConfig["build"]> = {};

  if (user.build?.target === undefined) {
    build.target = "esnext";
  }

  if (user.build?.assetsInlineLimit === undefined) {
    build.assetsInlineLimit = 0;
  }

  return build;
}

function siteDefines(site: SiteFacts) {
  const define: Record<string, string> = {};
  define["import.meta.env.SITE_URL"] = JSON.stringify(site.url ?? "");
  define["import.meta.env.SITE_INDEXABLE"] = JSON.stringify(site.indexable);
  define["import.meta.env.SITE_NAME"] = JSON.stringify(site.name ?? "");
  define["import.meta.env.SITE_LOCALE"] = JSON.stringify(site.locale ?? "");
  define["import.meta.env.SITE_IMAGE"] = JSON.stringify(site.image ?? null);

  return define;
}

/** The paths the smoke run skips, or no file when no extension serves any. */
function writePaths(root: string, served: readonly string[]) {
  const file = path.join(root, PATHS_FILE);

  if (served.length === 0) {
    return rmSync(file, { force: true });
  }

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(served));
}

function chainPlugin(chain: Chain): Plugin {
  const pattern = [CHAIN_ID, ROUTER_ID].map(escapeRegExp);

  return {
    name: "visio:middleware",
    resolveId: {
      filter: { id: new RegExp(`^(?:${pattern.join("|")})$`, "u") },
      handler: (id) => `\0${id}`,
    },
    load: {
      filter: { id: new RegExp(`^\\0(?:${pattern.join("|")})$`, "u") },
      handler(id) {
        const root = chain.root ?? process.cwd();

        if (id === `\0${ROUTER_ID}`) {
          return `import { routes } from ${JSON.stringify(path.resolve(root, ROUTES))};\nexport const Router = routes.Router;`;
        }

        if (id !== `\0${CHAIN_ID}`) {
          return;
        }

        const lines = [
          "import { apiMiddleware, isPage } from '@visio/router/internal/api';",
          "import { crawlMiddleware } from '@visio/router/internal/crawl';",
          `import { routes } from ${JSON.stringify(path.resolve(root, ROUTES))};`,
          "const settleCrawl = crawlMiddleware(routes);",
        ];

        const list = ["settleCrawl"];

        if (chain.deploy) {
          lines.push(`import deploy from ${JSON.stringify(chain.deploy)};`);
          list.push("deploy");
        }

        // After the deployment's middleware too, so the reads of announce() tag the lists.
        const lists = fileURLToPath(new URL("lists.ts", import.meta.url));
        lines.push(
          `import { listsMiddleware } from ${JSON.stringify(lists)};`,
          "const liveLists = listsMiddleware(routes);"
        );
        list.push("liveLists");

        // After the deployment's middleware, which puts its cache on the event, so a copy's reads tag it; ahead of the site's own,
        // so the site's middleware sees the page request.
        const copies = fileURLToPath(
          import.meta.resolve("@visio/aeo/internal/middleware")
        );

        lines.push(
          `import { markdownMiddleware } from ${JSON.stringify(copies)};`,
          "const markdownCopy = markdownMiddleware((pathname) => isPage(routes.Router, pathname), { llms: import.meta.env.SITE_INDEXABLE && !import.meta.env.DEV });"
        );
        list.push("markdownCopy");

        for (const [i, module] of (chain.extensions ?? []).entries()) {
          lines.push(`import extension${i} from ${JSON.stringify(module)};`);
          list.push(`extension${i}`);
        }

        if (chain.site) {
          lines.push(
            `import site from ${JSON.stringify(path.resolve(root, chain.site))};`
          );
          list.push("...site");
        }

        list.push("apiMiddleware(routes.api)");
        lines.push(`export default [${list.join(", ")}];`);

        return lines.join("\n");
      },
    },
  };
}

const LOCALE = /^[a-z]{2}_[A-Z]{2}$/u;

function checkLocale(locale: string | undefined): void {
  if (locale === undefined || LOCALE.test(locale)) {
    return;
  }

  const { language, country } =
    /^(?<language>[a-z]{2})[-_](?<country>[a-z]{2})$/iu.exec(locale)?.groups ??
    {};

  const fix =
    language && country
      ? `Write ${JSON.stringify(`${language.toLowerCase()}_${country.toUpperCase()}`)}.`
      : "Write the language in lower case, an underscore, and the country in upper case, such as 'de_DE' or 'en_US'.";

  throw new Error(
    `[visio] site.locale is ${JSON.stringify(locale)}, but og:locale takes language_COUNTRY (ll_CC). ${fix}`
  );
}

interface RouterParts {
  wiring: CrawlWiring;
  reserved: readonly ReservedPath[];
  routes: RouteFacts;
  llms: PrerenderIntegration;
  lists: PrerenderIntegration;
  deploy?: PrerenderIntegration | undefined;
}

/**
 * The router and the crawl with the extensions' parts, then the
 * extensions' own plugins. The deploy output is the last integration: it
 * writes the pages the others may have changed.
 */
function routerPlugins(
  parts: RouterParts,
  extensions: readonly VisioExtension[] = []
): Plugin[] {
  const { wiring, reserved, routes } = parts;
  wiring.integrations = [
    parts.llms,
    ...extensions.flatMap((e) => e.integrations ?? []),
    // After the extensions', which may change the pages; ahead of the output, which inlines the lists.
    parts.lists,
    ...(parts.deploy ? [parts.deploy] : []),
  ];

  return [
    ...router(
      wiring,
      reserved,
      routes,
      extensions.flatMap((e) => (e.routes ? [e.routes] : []))
    ),
    ...extensions.flatMap((e) => e.plugins ?? []),
  ];
}

function deployFacts(
  extensions: readonly VisioExtension[],
  routes: RouteFacts,
  holder: ListsHolder
): DeployFacts {
  return {
    studioPath: extensions.find((e) => e.app)?.app,
    open: extensions.flatMap((e) => e.open ?? []),
    routes,
    lists: () => holder.lists,
  };
}

/** What `visio()` takes from the extensions, once each has what the others give. */
function extensionParts(extensions: readonly VisioExtension[]) {
  const languages = extensions.find((e) => e.languages)?.languages;

  for (const extension of extensions) {
    extension.connect?.({ languages });
  }

  const chain: Chain = {
    extensions: extensions.flatMap((e) => (e.middleware ? [e.middleware] : [])),
  };

  return {
    served: extensions.flatMap((e) => e.served ?? []),
    reserved: extensions.flatMap((e) =>
      (e.served ?? []).map((p) => ({ path: p, by: e.name }))
    ),
    chain,
  };
}

/** `studio` of `visio()`, until the call of `sanity()` took it (2026-10-26). */
function studioMoved(
  studio: boolean | { path?: string; api?: string } | undefined
): string {
  const fix =
    studio === false || studio === undefined
      ? "Remove studio."
      : `Add \`extensions: [sanity(${studio === true ? "" : `{ studio: ${JSON.stringify(studio)} }`})]\` with \`import { sanity } from "@visio/sanity/vite"\` in vite.config.ts, and remove studio.`;

  return `[visio] [STUDIO_MOVED] studio is gone from visio(): Sanity is an extension. ${fix}`;
}

export function plugins(options: InternalOptions): Plugin[] {
  if ("prerender" in options) {
    throw new Error(
      "[visio] prerender is gone from visio(): the build always crawls from '/', and the router names every route nothing links to. Remove prerender from vite.config.ts, and move the paths its filter skipped into `pending: [...]` of defineRoutes() in src/routes.ts."
    );
  }

  for (const key of ["url", "indexable"]) {
    if (options.site && key in options.site) {
      throw new Error(
        `[visio] site.${key} is a fact of the deployment, read from PUBLIC_SITE_${key.toUpperCase()} in the env. Remove it from vite.config.ts and set the variable instead.`
      );
    }
  }

  if ("studio" in options) {
    // SAFETY: the shape `studio` had in VisioOptions.
    const { studio } = options as {
      studio: boolean | { path?: string } | undefined;
    };

    throw new Error(studioMoved(studio));
  }

  const site: SiteFacts = { ...options.site, indexable: false };
  checkLocale(site.locale);
  const extensions = options.extensions ?? [];
  const { served, reserved, chain } = extensionParts(extensions);
  const solidConfig = options.solid === false ? undefined : solidOptions();

  const list: Plugin[] = [
    // First: every config hook after it reads the env it puts in process.env.
    ...envPlugins({ platform: options.deploy?.env }),
    configPlugin(site, solidConfig, served, chain),
    prerenderEnv(),
    asyncRender(),
  ];

  if (options.images !== false) {
    list.push(images());
  }

  if (options.svg !== false) {
    list.push(svg());
  }

  list.push(icons(site));

  if (options.styling !== false) {
    list.push(...styling());
  }

  list.push(aeoDev());

  if (solidConfig) {
    list.push(...solid(solidConfig));
  }

  // Filled when the router reads src/routes.ts, before the crawl and the output.
  const routes: RouteFacts = { cached: [], uncached: [], api: [], pending: [] };

  // Filled when the crawl ends, before the output inlines it.
  const holder: ListsHolder = {};

  const deploy = options.deploy?.output(
    deployFacts(extensions, routes, holder)
  );

  chain.deploy = options.deploy?.middleware;
  list.push(
    ...routerPlugins(
      {
        wiring: crawlWiring(site, served, options.aeo),
        reserved,
        routes,
        llms: llmsFile(site),
        lists: listsIntegration(site, holder),
        deploy: deploy?.integration,
      },
      extensions
    )
  );

  if (solidConfig) {
    list.push(chainPlugin(chain));
  }

  list.push(...(deploy?.plugins ?? []));

  return list;
}
