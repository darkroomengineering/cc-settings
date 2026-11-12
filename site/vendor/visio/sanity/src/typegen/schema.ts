import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { SchemaType } from "groq-js";

export type { SchemaType } from "groq-js";

/** What `Schema.compile()` returns; only `extractSchema()` reads it. */
export interface CompiledSchema {
  readonly name: string;
}

export interface SchemaLib {
  Schema: {
    compile: (options: { name: string; types: unknown[] }) => CompiledSchema;
  };
  builtinTypes: unknown[];
  extractSchema: (
    schema: CompiledSchema,
    options: { enforceRequiredFields: boolean }
  ) => SchemaType;
}

export function compileSchema(types: unknown[], lib: SchemaLib): SchemaType {
  const compiled = lib.Schema.compile({
    name: "default",
    types: [...lib.builtinTypes, ...types],
  });

  return lib.extractSchema(compiled, { enforceRequiredFields: true });
}

interface PackageJson {
  version: string;
  dependencies?: Record<string, string>;
}

function readPackageJson(file: string): PackageJson {
  return JSON.parse(readFileSync(file, "utf-8"));
}

/**
 * The schema files and `sanity` must share one `@sanity/types`: two copies
 * compile the schema against one and the Studio against the other.
 */
export function checkTypesVersion(
  studio: string,
  sanityPackageJson: string
): void {
  const types = path.join(
    studio,
    "node_modules",
    "@sanity",
    "types",
    "package.json"
  );

  if (!existsSync(types)) {
    return;
  }

  const { version: sanityVersion, dependencies = {} } =
    readPackageJson(sanityPackageJson);

  const wanted = dependencies["@sanity/types"];
  const { version } = readPackageJson(types);

  // Only an exact version: a range would take more than one.
  if (wanted && /^\d/v.test(wanted) && wanted !== version) {
    throw new Error(
      `The Studio has @sanity/types ${version}, but sanity ${sanityVersion} needs ${wanted}. ` +
        `Set "@sanity/types": "${wanted}" in the catalog of the root package.json, beside sanity, and run \`bun install\`.`
    );
  }
}

/**
 * `@sanity/schema` as the Studio's own `sanity` install has it, so the
 * built-in types always match the Studio's version.
 */
export async function studioSchemaLib(studio: string): Promise<SchemaLib> {
  const sanityPackageJson = path.join(
    studio,
    "node_modules",
    "sanity",
    "package.json"
  );

  if (!existsSync(sanityPackageJson)) {
    throw new Error(
      `No \`sanity\` in ${studio}. Run \`bun install\` at the workspace root.`
    );
  }

  checkTypesVersion(studio, sanityPackageJson);
  const require = createRequire(realpathSync(sanityPackageJson));

  function load(id: string) {
    return import(pathToFileURL(require.resolve(id)).href);
  }

  const [main, internal] = await Promise.all([
    load("@sanity/schema"),
    load("@sanity/schema/_internal"),
  ]);

  return {
    Schema: main.Schema,
    builtinTypes: internal.builtinTypes,
    extractSchema: internal.extractSchema,
  };
}

/** What typegen gives a composer: no project or dataset, which only the Studio has. */
type ComposerContext = Readonly<Record<string, never>>;

/** A plugin's `schema.types`: a list, or a composer of the types before it. */
type TypesOption =
  | readonly unknown[]
  | ((prev: unknown[], context: ComposerContext) => unknown[]);

/** A Studio plugin as typegen reads it: the types it adds, and the plugins it brings. */
interface PluginNode {
  readonly schema?: { readonly types?: TypesOption };
  readonly plugins?: readonly PluginNode[];
}

function isTypeList(types: TypesOption): types is readonly unknown[] {
  return Array.isArray(types);
}

function typesOf(types: TypesOption | undefined): readonly unknown[] {
  if (types === undefined) {
    return [];
  }

  // A composer adds to the types before it; typegen has the site's already.
  return isTypeList(types) ? types : types([], {});
}

/** The schema types the plugins add, nested plugins too. */
export function pluginTypes(plugins: readonly PluginNode[]): unknown[] {
  return plugins.flatMap((plugin) => [
    ...typesOf(plugin.schema?.types),
    ...pluginTypes(plugin.plugins ?? []),
  ]);
}

const CONFIGS = ["sanity.config.ts", "sanity.config.tsx", "sanity.config.js"];

/** The plugins of the Studio's config, so their types are typed too (sanity-plugin-internationalized-array). */
async function configPlugins(
  studio: string,
  load: (file: string) => Promise<{ default?: unknown }>
): Promise<PluginNode[]> {
  const file = CONFIGS.map((name) => path.join(studio, name)).find((f) =>
    existsSync(f)
  );

  if (!file) {
    return [];
  }

  let config: unknown;

  try {
    ({ default: config } = await load(file));
  } catch (error) {
    throw new Error(
      `[@visio/sanity] [TYPEGEN_CONFIG_FAILED] ${path.basename(file)} threw while typegen read its plugins' schema types.`,
      { cause: error }
    );
  }

  // SAFETY: a Sanity config is one workspace or a list of them, each with its plugins.
  const workspaces = [config].flat() as { plugins?: PluginNode[] }[];

  return workspaces.flatMap((workspace) => workspace.plugins ?? []);
}

export async function loadStudioSchema(studio: string): Promise<SchemaType> {
  const entry = path.join(studio, "schemaTypes", "index.ts");

  if (!existsSync(entry)) {
    throw new Error(
      `[@visio/sanity] [SCHEMA_MISSING] ${entry} does not exist. Typegen reads the schema types from there: export \`schemaTypes\` from it, or remove sanity() from \`extensions\` of vite.config.ts when the site reads no Sanity data.`
    );
  }

  // Loaded on use: Vite at module load crashes `bun test`, which only needs compileSchema.
  const { runnerImport } = await import("vite");

  async function load<T>(file: string): Promise<T> {
    const { module } = await runnerImport<T>(file, {
      configFile: false,
      root: studio,
      logLevel: "silent",
    });

    return module;
  }

  const module = await load<{ schemaTypes?: unknown[] }>(entry);

  if (!Array.isArray(module.schemaTypes)) {
    throw new TypeError(`${entry} has no \`schemaTypes\` array export.`);
  }

  const plugins = await configPlugins(studio, load);

  return compileSchema(
    [...module.schemaTypes, ...pluginTypes(plugins)],
    await studioSchemaLib(studio)
  );
}
