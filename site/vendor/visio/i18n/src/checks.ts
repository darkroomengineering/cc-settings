import path from "node:path";

import {
  child,
  children,
  contains,
  isCall,
  isIdentifier,
  lineOf,
  property,
  stringValue,
} from "@visio/router/internal/vite";
import type {
  AstNode,
  Diagnostic,
  RouteSite,
  RouteTable,
  TableCheck,
} from "@visio/router/internal/vite";
import type { ResolvedConfig } from "vite";

const PACKAGE = "@visio/i18n";
const LANGUAGE_TAG = /^[a-z]{2,3}$/v;
const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/v;

/** The languages `defineLanguages()` declares, as the build reads them. */
export interface TableLanguages {
  locales: Record<string, string>;
  default: string;
}

function error(
  table: RouteTable,
  code: string,
  message: string,
  node: AstNode
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    file: table.file,
    line: lineOf(table.code, node.start),
  };
}

function keyName(prop: AstNode): string | undefined {
  const key = child(prop, "key");

  return isIdentifier(key) ? key.name : stringValue(key);
}

/** An object literal of literal strings, or undefined when it is anything else. */
export function literalRecord(
  node: AstNode | undefined
): Record<string, string> | undefined {
  if (node?.type !== "ObjectExpression") {
    return undefined;
  }

  const out: Record<string, string> = {};

  for (const prop of children(node, "properties")) {
    const name = keyName(prop);
    const value = stringValue(child(prop, "value"));

    if (prop.type !== "Property" || name === undefined || value === undefined) {
      return undefined;
    }

    out[name] = value;
  }

  return out;
}

/** The local name `defineLanguages` has in the routes file. */
function defineName(body: readonly AstNode[]): string | undefined {
  for (const statement of body) {
    if (
      statement.type !== "ImportDeclaration" ||
      stringValue(child(statement, "source")) !== PACKAGE
    ) {
      continue;
    }

    for (const specifier of children(statement, "specifiers")) {
      const imported = child(specifier, "imported");
      const local = child(specifier, "local");

      if (
        isIdentifier(imported) &&
        imported.name === "defineLanguages" &&
        isIdentifier(local)
      ) {
        return local.name;
      }
    }
  }

  return undefined;
}

/** A top-level `const` of the routes file: its name and its value. */
interface Declared {
  name: string;
  init: AstNode | undefined;
}

function topLevelConsts(body: readonly AstNode[]): Declared[] {
  const out: Declared[] = [];

  for (const statement of body) {
    const decl =
      statement.type === "ExportNamedDeclaration"
        ? child(statement, "declaration")
        : statement;

    if (decl?.type !== "VariableDeclaration" || decl.kind !== "const") {
      continue;
    }

    for (const d of children(decl, "declarations")) {
      const id = child(d, "id");

      if (isIdentifier(id)) {
        out.push({ name: id.name, init: child(d, "init") });
      }
    }
  }

  return out;
}

/** Where the routes file calls `defineLanguages()`, and the name it gives the result. */
interface Declaration {
  call: AstNode & { arguments: AstNode[] };
  name: string;
}

function declaration(table: RouteTable): Declaration | undefined {
  const define = defineName(table.body);

  if (!define) {
    return undefined;
  }

  for (const { name, init } of topLevelConsts(table.body)) {
    if (
      isCall(init) &&
      isIdentifier(init.callee) &&
      init.callee.name === define
    ) {
      return { call: init, name };
    }
  }

  return undefined;
}

/** Whether `extensions` of `defineRoutes()` holds the languages. */
function isPassed(table: RouteTable, name: string): boolean {
  const list = property(table.options, "extensions");

  return children(list, "elements").some(
    (item) => isIdentifier(item) && item.name === name
  );
}

function localeDiagnostics(
  table: RouteTable,
  locales: Record<string, string>,
  node: AstNode
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [tag, locale] of Object.entries(locales)) {
    if (!LANGUAGE_TAG.test(tag)) {
      diagnostics.push(
        error(
          table,
          "LANGUAGE_TAG_INVALID",
          `locales has ${JSON.stringify(tag)}, but a key is a language tag of two or three lowercase letters, such as 'de': it is the hreflang, the <html lang> and the URL prefix, and Google reads a language without a region.`,
          node
        )
      );
    }

    if (!LOCALE.test(locale)) {
      diagnostics.push(
        error(
          table,
          "LANGUAGE_LOCALE_INVALID",
          `locales.${tag} is ${JSON.stringify(locale)}, but the value is the og:locale, language_COUNTRY, such as 'de_DE'.`,
          node
        )
      );
    }
  }

  return diagnostics;
}

const HOW =
  "export const languages = defineLanguages({ locales: { de: 'de_DE', it: 'it_IT' }, default: 'de' })";

/** The languages of the routes file, checked; undefined when the build cannot read them. */
export function readLanguages(
  table: RouteTable,
  diagnostics: Diagnostic[]
): TableLanguages | undefined {
  const found = declaration(table);

  if (!found) {
    diagnostics.push({
      code: "LANGUAGES_MISSING",
      severity: "error",
      message: `i18n() of visio() reads the site's languages from ${path.basename(table.file)}, which has no top-level defineLanguages() from @visio/i18n. Add ${HOW}, and pass it in extensions of defineRoutes(); or remove i18n() from vite.config.ts.`,
      file: table.file,
    });

    return undefined;
  }

  const { call, name } = found;
  const [options] = call.arguments;
  const locales = literalRecord(property(options, "locales"));
  const first = stringValue(property(options, "default"));

  if (!locales || Object.keys(locales).length === 0 || first === undefined) {
    diagnostics.push(
      error(
        table,
        "LANGUAGES_NOT_STATIC",
        `defineLanguages() needs an object literal with literal values, ${HOW}, so the build reads the site's languages without running the table.`,
        call
      )
    );

    return undefined;
  }

  diagnostics.push(...localeDiagnostics(table, locales, call));

  if (!Object.hasOwn(locales, first)) {
    diagnostics.push(
      error(
        table,
        "LANGUAGE_DEFAULT_UNKNOWN",
        `defineLanguages() has default '${first}', which is not one of ${Object.keys(
          locales
        )
          .map((l) => `'${l}'`)
          .join(
            ", "
          )}: the default is the language at the root, without a prefix.`,
        call
      )
    );

    return undefined;
  }

  if (!isPassed(table, name)) {
    diagnostics.push(
      error(
        table,
        "LANGUAGES_NOT_PASSED",
        `${name} of defineLanguages() is not in extensions of defineRoutes(), so the router serves the default language only. Add extensions: [${name}] to its options.`,
        call
      )
    );
  }

  if (
    !/declare\s+module\s+["']@visio\/i18n["'][\s\S]*interface\s+Register\b[\s\S]*languages\s*:\s*typeof\s/v.test(
      table.code
    )
  ) {
    diagnostics.push({
      code: "LANGUAGES_NOT_REGISTERED",
      severity: "error",
      message: `${path.basename(table.file)} declares languages but does not register them, so Lang is a string and props.lang and paths(lang) lose their types. Add: declare module "@visio/i18n" { interface Register { languages: typeof ${name} } }`,
      file: table.file,
    });
  }

  return { locales, default: first };
}

/** The enclosing layout of a site. */
function layoutOf(table: RouteTable, site: RouteSite): RouteSite | undefined {
  return table.sites.findLast(
    (s) => s.helper === "layout" && s !== site && contains(s.call, site.call)
  );
}

/**
 * A site's paths in the other languages, from the table alone: its
 * translated paths, and an index's are its layout's. The router counts them
 * with the site's own (`RoutesExtension.sitePaths`).
 */
export function sitePaths(
  site: RouteSite,
  _full: string,
  table: RouteTable
): string[] {
  const own = site.helper === "index" ? layoutOf(table, site) : site;

  return Object.values(literalRecord(own?.options) ?? {});
}

function paramNames(pattern: string): string {
  return pattern
    .split("/")
    .filter((segment) => /^[:*]/v.test(segment))
    .map((segment) => segment.replace(/\?$/v, ""))
    .toSorted()
    .join(", ");
}

/** Whether `full` is `at` or below it, segment by segment. */
function isUnder(full: string, at: string): boolean {
  return at === "/" || full === at || full.startsWith(`${at}/`);
}

interface SiteCheck {
  table: RouteTable;
  site: RouteSite;
  languages: TableLanguages;
  /** The site's full default-language path. */
  at: string;
}

/** The check of one translated path, or undefined when it is right. */
function pathDiagnostic(
  check: SiteCheck,
  lang: string,
  to: string,
  node: AstNode
): Diagnostic | undefined {
  const { table, site, languages, at } = check;
  const call = `${site.helper}('${at}', ...)`;

  if (lang === languages.default) {
    return error(
      table,
      "TRANSLATION_LANGUAGE_DEFAULT",
      `${call} lists '${lang}', the default language, among its translations. The first argument is the ${lang} path; list only the other languages.`,
      node
    );
  }

  if (!Object.hasOwn(languages.locales, lang)) {
    return error(
      table,
      "TRANSLATION_LANGUAGE_UNKNOWN",
      `${call} has a path for '${lang}', which is not in the locales of defineLanguages() (${Object.keys(languages.locales).join(", ")}).`,
      node
    );
  }

  if (!isUnder(to, `/${lang}`) || to === "/") {
    return error(
      table,
      "TRANSLATION_PREFIX_MISSING",
      `${call} gives '${lang}' the path '${to}'. Every ${lang} path starts with /${lang}: write '/${lang}${to === "/" ? "" : to}'.`,
      node
    );
  }

  if (paramNames(to) !== paramNames(at)) {
    return error(
      table,
      "TRANSLATION_PARAMS_DIFFER",
      `${call} gives '${lang}' the path '${to}', whose params differ (${paramNames(to) || "none"} against ${paramNames(at) || "none"}). Translate the words of a path and keep its params, so a page has the same params in every language.`,
      node
    );
  }

  const parent = layoutOf(table, site);

  if (parent?.path === undefined) {
    return undefined;
  }

  const under = literalRecord(parent.options)?.[lang];

  if (under !== undefined && isUnder(to, under)) {
    return undefined;
  }

  return error(
    table,
    "TRANSLATION_OUTSIDE_LAYOUT",
    under === undefined
      ? `${call} has a '${lang}' path, but its layout('${parent.path}') has none. Give the layout its ${lang} path too.`
      : `${call} gives '${lang}' the path '${to}', which is not under its layout's ${lang} path '${under}'.`,
    node
  );
}

/** The checks of a site's translated paths. */
function translationDiagnostics(check: SiteCheck): Diagnostic[] {
  const node = check.site.options;

  if (!node) {
    return [];
  }

  const paths = literalRecord(node);

  if (!paths) {
    return [
      error(
        check.table,
        "TRANSLATIONS_NOT_STATIC",
        `${check.site.helper}('${check.at}', ...) needs its translated paths as an object literal of literal paths, e.g. { it: '/it/progetti/:slug' }, so the build reads them without running the table.`,
        node
      ),
    ];
  }

  return Object.entries(paths).flatMap(
    ([lang, to]) => pathDiagnostic(check, lang, to, node) ?? []
  );
}

/** A default path under another language's prefix: the router would read it as that language. */
function prefixDiagnostics(check: SiteCheck): Diagnostic[] {
  const { table, site, languages, at } = check;
  const [, first = ""] = at.split("/", 2);

  if (first === languages.default || !Object.hasOwn(languages.locales, first)) {
    return [];
  }

  return [
    error(
      table,
      "PATH_UNDER_LANGUAGE",
      `${site.helper}('${at}') starts with /${first}, the prefix of the language '${first}', so the router would read it as a ${first} page. Write the ${languages.default} path as the first argument and the ${first} one in its translations.`,
      site.call
    ),
  ];
}

/** What the checks of a translated route read of its module's options. */
interface OptionFacts {
  /** The options are an object literal, so the two below are known. */
  literal: boolean;
  preload: boolean;
  translations: boolean;
  /** A param whose match filter is a list of words. */
  listFilter?: string;
}

function optionFacts(options: AstNode | undefined): OptionFacts {
  if (options?.type !== "ObjectExpression") {
    return { literal: false, preload: false, translations: false };
  }

  const facts: OptionFacts = {
    literal: children(options, "properties").every(
      (p) => p.type === "Property"
    ),
    preload: property(options, "preload") !== undefined,
    translations: property(options, "translations") !== undefined,
  };

  for (const prop of children(
    property(options, "matchFilters"),
    "properties"
  )) {
    if (child(prop, "value")?.type === "ArrayExpression") {
      facts.listFilter = keyName(prop) ?? "";
    }
  }

  return facts;
}

/** Where a translated route's module disagrees with its paths. */
function moduleDiagnostics(
  check: SiteCheck,
  modules: TableCheck["modules"]
): Diagnostic[] {
  const { table, site, at } = check;
  const found = modules.get(site);
  // An index is in each language of its layout.
  const own = site.helper === "index" ? layoutOf(table, site) : site;

  if (!own?.options || !found) {
    return [];
  }

  const rel = path.relative(path.dirname(table.file), found.file);
  const facts = optionFacts(found.facts.options);
  const diagnostics: Diagnostic[] = [];
  // A layout has no `translations`: its pages decide where they exist.
  const page = site.helper !== "layout";

  if (page && facts.literal && facts.preload && !facts.translations) {
    diagnostics.push(
      error(
        table,
        "ROUTE_NEEDS_TRANSLATIONS",
        `${site.helper === "index" ? `index() at '${at}'` : `${site.helper}('${at}')`} has translated paths and ${rel} has a preload, so the page's data decides which languages it exists in. Add translations: ({ data }) => ... to its defineRoute(), with its params in each language (a language left out answers 404).`,
        site.call
      )
    );
  }

  if (facts.listFilter !== undefined) {
    diagnostics.push(
      error(
        table,
        "MATCH_FILTER_NOT_TRANSLATABLE",
        `${site.helper}('${at}') has translated paths, but ${rel} filters :${facts.listFilter} with a list of words, and those words differ by language. Write one page() per word instead, each with its own translated paths.`,
        site.call
      )
    );
  }

  return diagnostics;
}

/** What the checks read of the Vite config. */
export interface ConfigFacts {
  /** `site.locale` of visio(). */
  siteLocale: string;
  /** The config file, for a finding in it. */
  file: string;
}

/** What the checks read of the resolved Vite config. */
export function configFacts(
  resolved: Pick<ResolvedConfig, "define" | "configFile">
): ConfigFacts {
  // visio() defines it as a JSON string, the empty one without a locale.
  const locale = String(
    JSON.parse(String(resolved.define?.["import.meta.env.SITE_LOCALE"] ?? '""'))
  );

  return { siteLocale: locale, file: resolved.configFile ?? "vite.config.ts" };
}

/** Every check of the table's languages. */
export function languageDiagnostics(
  check: TableCheck,
  config: ConfigFacts
): Diagnostic[] {
  const { table, full, modules } = check;
  const diagnostics: Diagnostic[] = [];
  const languages = readLanguages(table, diagnostics);

  if (!languages) {
    return diagnostics;
  }

  if (config.siteLocale) {
    diagnostics.push({
      code: "SITE_LOCALE_CONFLICTS",
      severity: "error",
      message: `site.locale of visio() is ${JSON.stringify(config.siteLocale)}, but the site declares languages, each with its own og:locale. Remove site.locale.`,
      file: config.file,
    });
  }

  for (const site of table.sites) {
    const at = full.get(site);

    if (at === undefined || site.helper === "api") {
      continue;
    }

    const one: SiteCheck = { table, site, languages, at };
    diagnostics.push(
      ...translationDiagnostics(one),
      ...prefixDiagnostics(one),
      ...moduleDiagnostics(one, modules)
    );
  }

  return diagnostics;
}
