import type { AeoOptions } from "@visio/aeo";
import type { SiteLanguages } from "@visio/router/internal/extend";
import type { RoutesExtension } from "@visio/router/internal/vite";
import type { PrerenderIntegration } from "prerender-crawler/vite";
import type { Plugin } from "vite";

import { checkDeploy } from "./deploy.ts";
import type { Deployment } from "./deploy.ts";
import { plugins } from "./plugins.ts";

/**
 * The site's own facts. The deployment's facts come from the env, not from
 * here: `PUBLIC_SITE_URL` (the origin) and `PUBLIC_SITE_INDEXABLE` (`true`
 * lets search engines index it).
 */
export interface SiteOptions {
  /** `og:site_name` of every page. */
  name?: string | undefined;
  /** `og:locale` of every page: language and country, `ll_CC`, such as `de_DE`. */
  locale?: string | undefined;
  /** An absolute URL, or a path under `public/` resolved against `PUBLIC_SITE_URL`; 1200 by 630. */
  image?:
    | string
    | { url: string; width?: number; height?: number; alt?: string }
    | undefined;
}

export interface VisioOptions {
  /** Where the build deploys: `vercel()` of `@visio/vercel`, or `cloudflare()` of `@visio/cloudflare`. */
  deploy: Deployment;
  site?: SiteOptions;
  /** The AI crawlers `robots.txt` lets in, in an indexable build. Default: both may crawl, and `Content-Signal` states no `ai-train`. */
  aeo?: AeoOptions;
  /**
   * What optional packages add to the build: each package's call gives its
   * extension, such as `i18n()` of `@visio/i18n/vite` or `sanity()` of `@visio/sanity/vite`.
   */
  extensions?: readonly VisioExtension[];
}

/** The build part of an optional package (the DESIGN.md of `@visio/router`, Extensions). */
export interface VisioExtension {
  /** Its npm name, for the messages. */
  readonly name: string;
  /** Its checks and facts of `src/routes.ts`. */
  readonly routes?: RoutesExtension;
  /** Its parts of the prerender crawl, after visio's own. */
  readonly integrations?: readonly PrerenderIntegration[];
  /** Its own Vite plugins, after the router's. */
  readonly plugins?: readonly Plugin[];
  /** Paths it serves itself: no route of the site may be under one, and the crawl and the smoke run skip them. */
  readonly served?: readonly string[];
  /** A module whose default export is a middleware, on the chain after the Markdown copy and before the site's own. */
  readonly middleware?: string;
  /** A single-page app it serves: the output answers every path under it with its `index.html`. */
  readonly app?: string;
  /** Paths the password gate lets through. */
  readonly open?: readonly string[];
  /** The site's languages, for the Studio's check: `@visio/i18n/vite`. */
  readonly languages?: (root: string) => SiteLanguages | undefined;
  /** Called once with what the other extensions give, before the build starts. */
  readonly connect?: (args: ExtensionArgs) => void;
}

/** What `connect` of an extension receives. */
export interface ExtensionArgs {
  /** `languages` of the extension that has it. */
  languages?: ((root: string) => SiteLanguages | undefined) | undefined;
}

export type { AeoOptions } from "@visio/aeo";

export function visio(options: VisioOptions): Plugin[] {
  checkDeploy(options);

  return plugins(options);
}
