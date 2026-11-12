import type { Plugin } from "vite";

import type { SiteLanguagesOf } from "./studio-languages.ts";
import { sanityPaths, sanityTypes, studio } from "./vite.ts";

export interface SanityOptions {
  /**
   * The Studio in `../studio`, and its draft mode and publish routes. Default
   * `true`. `false` keeps only the query types, for a site that reads a
   * dataset whose Studio it does not serve.
   */
  studio?:
    | boolean
    | {
        /** Where the site serves the Studio. Default `/studio`. */
        path?: string;
        /** Where the site serves the draft mode and publish routes. Default `/api/sanity`. */
        api?: string;
      };
}

/** What `sanity()` gives `extensions` of `visio()`. */
interface SanityExtension {
  readonly name: string;
  readonly plugins: readonly Plugin[];
  readonly served?: readonly string[];
  readonly middleware?: string;
  readonly app?: string;
  readonly open?: readonly string[];
  readonly connect?: (args: { languages?: SiteLanguagesOf }) => void;
}

/**
 * The build part of `@visio/sanity`, for `extensions` of `visio()`: the
 * site's query types in `sanity.types.d.ts`, and with the Studio on, the
 * Studio app and its draft mode and publish routes.
 */
export function sanity(options: SanityOptions = {}): SanityExtension {
  const paths = sanityPaths(options.studio ?? true);
  const name = "@visio/sanity";

  if (!paths) {
    return { name, plugins: [sanityTypes()] };
  }

  let languages: SiteLanguagesOf | undefined;

  return {
    name,
    plugins: [sanityTypes(), ...studio(paths, () => languages)],
    served: [paths.studio, paths.api],
    middleware: "@visio/sanity/internal/middleware",
    app: paths.studio,
    open: [`${paths.api}/revalidate`],
    connect(args) {
      ({ languages } = args);
    },
  };
}
