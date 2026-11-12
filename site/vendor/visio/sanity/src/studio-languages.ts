import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SiteLanguages } from "@visio/router/internal/extend";
import { parseSync } from "oxc-parser";
import type { Expression, ObjectExpression } from "oxc-parser";

import { localName } from "./studio-check.ts";
import type { StudioFinding } from "./studio-check.ts";

const SCHEMA_ENTRY = "@visio/sanity/studio/schema";

/** Where the Studio declares its languages, from the Studio's folder. */
export const LANGUAGES_FILE = path.join("schemaTypes", "languages.ts");

const HOW =
  "export const languages = defineStudioLanguages({ titles: { de: 'Deutsch', it: 'Italiano' }, default: 'de' })";

/** The languages `defineStudioLanguages()` declares, as the build reads them. */
interface StudioTags {
  tags: string[];
  default: string;
  line: number;
}

function keyOf(property: ObjectExpression["properties"][number]) {
  if (property.type !== "Property" || property.computed) {
    return;
  }

  const { key } = property;

  if (key.type === "Identifier") {
    return key.name;
  }

  return key.type === "Literal" && typeof key.value === "string"
    ? key.value
    : undefined;
}

function propertyOf(node: ObjectExpression, name: string) {
  for (const property of node.properties) {
    if (property.type === "Property" && keyOf(property) === name) {
      return property.value;
    }
  }
}

function stringOf(node: Expression | undefined) {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

function literalKeys(node: Expression | undefined): string[] | undefined {
  if (node?.type !== "ObjectExpression") {
    return undefined;
  }

  const keys: string[] = [];

  for (const property of node.properties) {
    const key = keyOf(property);

    if (
      key === undefined ||
      property.type !== "Property" ||
      stringOf(property.value) === undefined
    ) {
      return undefined;
    }

    keys.push(key);
  }

  return keys;
}

/** The call in the file, `undefined` without one, `"not static"` when its options are not literal. */
export function readStudioLanguages(
  source: string,
  file: string
): StudioTags | "not static" | undefined {
  const { program } = parseSync(file, source);
  const local = localName(program, SCHEMA_ENTRY, "defineStudioLanguages");

  if (!local) {
    return undefined;
  }

  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;

    if (declaration?.type !== "VariableDeclaration") {
      continue;
    }

    for (const { init } of declaration.declarations) {
      if (
        init?.type !== "CallExpression" ||
        init.callee.type !== "Identifier" ||
        init.callee.name !== local
      ) {
        continue;
      }

      const [options] = init.arguments;

      if (options?.type !== "ObjectExpression") {
        return "not static";
      }

      const tags = literalKeys(propertyOf(options, "titles"));
      const first = stringOf(propertyOf(options, "default"));

      if (!tags?.length || first === undefined) {
        return "not static";
      }

      return {
        tags,
        default: first,
        line: source.slice(0, init.start).split("\n").length,
      };
    }
  }

  return "not static";
}

function finding(code: string, message: string, at?: string): StudioFinding {
  return {
    level: "error",
    message: `[@visio/sanity] [${code}] ${message}${at ? `\n  at ${at}` : ""}`,
  };
}

/**
 * Whether the Studio's languages and the site's agree. `site` is
 * `undefined` without `i18n()`, and `null` when its own check failed.
 */
export function compareLanguages(
  studio: StudioTags | "not static" | undefined,
  site: SiteLanguages | null | undefined,
  file: string
): StudioFinding[] {
  if (studio === "not static") {
    return [
      finding(
        "STUDIO_LANGUAGES_NOT_STATIC",
        `defineStudioLanguages() needs an object literal with literal titles and default, ${HOW}, so the build compares them with the site's without running the schema.`,
        file
      ),
    ];
  }

  if (site === undefined) {
    return studio
      ? [
          finding(
            "SITE_LANGUAGES_MISSING",
            `The Studio declares languages (${studio.tags.join(", ")}), but vite.config.ts has no i18n() in extensions of visio(), so the site has one language. Add i18n() from @visio/i18n/vite, or remove defineStudioLanguages() and translated().`,
            `${file}:${studio.line}`
          ),
        ]
      : [];
  }

  // The router's own finding names a table it cannot read; this check stays quiet.
  if (site === null) {
    return [];
  }

  if (!studio) {
    return [
      finding(
        "STUDIO_LANGUAGES_MISSING",
        `The site has languages, but the Studio declares none, so its content cannot follow them. Add ${HOW} in ${file}, with the tags of defineLanguages() in src/routes.ts, and pass it to defineStudio({ languages }).`
      ),
    ];
  }

  const same =
    studio.default === site.default &&
    studio.tags.length === site.tags.length &&
    studio.tags.every((tag) => site.tags.includes(tag));

  return same
    ? []
    : [
        finding(
          "STUDIO_LANGUAGES_DIFFER",
          `defineStudioLanguages() has ${studio.tags.join(", ")} with default '${studio.default}', but defineLanguages() in src/routes.ts has ${site.tags.join(", ")} with default '${site.default}'. Give the Studio the site's languages.`,
          `${file}:${studio.line}`
        ),
      ];
}

/** What reads the site's languages: `languages` of the extension of `@visio/i18n`. */
export type SiteLanguagesOf = (root: string) => SiteLanguages | undefined;

/** The check of the Studio's languages against the site's, in dev and in the build. `site` is undefined without `i18n()`. */
export function checkLanguages(
  studioDir: string,
  root: string,
  site?: SiteLanguagesOf
): StudioFinding[] {
  const file = path.join(studioDir, LANGUAGES_FILE);
  const shown = path.relative(root, file);

  const studio = existsSync(file)
    ? readStudioLanguages(readFileSync(file, "utf-8"), file)
    : undefined;

  return compareLanguages(
    studio,
    site ? (site(root) ?? null) : undefined,
    shown
  );
}
