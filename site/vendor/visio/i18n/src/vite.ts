import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SiteLanguages } from "@visio/router/internal/extend";
import { collectRoutes } from "@visio/router/internal/vite";
import type { RoutesExtension } from "@visio/router/internal/vite";
import type { Plugin } from "vite";

import {
  configFacts,
  languageDiagnostics,
  readLanguages,
  sitePaths,
} from "./checks.ts";
import type { ConfigFacts } from "./checks.ts";

/** What `i18n()` gives `extensions` of `visio()`. */
interface I18nExtension {
  readonly name: string;
  readonly routes: RoutesExtension;
  readonly plugins: readonly Plugin[];
  readonly languages: (root: string) => SiteLanguages | undefined;
}

/**
 * The languages of the site at `root`; undefined when the build cannot read
 * them, which the table's own checks report.
 */
function siteLanguages(root: string): SiteLanguages | undefined {
  const file = path.join(root, "src", "routes.ts");

  if (!existsSync(file)) {
    return;
  }

  const table = collectRoutes(readFileSync(file, "utf-8"), file);
  const languages = table && readLanguages(table, []);

  return languages
    ? { tags: Object.keys(languages.locales), default: languages.default }
    : undefined;
}

/**
 * The build part of `@visio/i18n`, for `extensions` of `visio()`: the
 * table's paths in every language for the cache, `live` and `pending`, and
 * the checks of the languages and the translated paths.
 */
export function i18n(): I18nExtension {
  const config: ConfigFacts = { siteLocale: "", file: "vite.config.ts" };

  return {
    name: "@visio/i18n",
    routes: {
      name: "@visio/i18n",
      sitePaths,
      diagnostics: (check) => languageDiagnostics(check, config),
    },
    languages: siteLanguages,
    plugins: [
      {
        name: "visio:i18n",
        configResolved(resolved) {
          Object.assign(config, configFacts(resolved));
        },
      },
    ],
  };
}
