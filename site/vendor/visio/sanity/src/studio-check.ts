import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";
import type {
  Expression,
  ImportDeclarationSpecifier,
  Program,
} from "oxc-parser";

export interface StudioFinding {
  /** An error stops the build; the dev server prints both. */
  level: "error" | "warning";
  message: string;
}

/** The files `@sanity/cli-core` looks for, in its order. */
const FILES = {
  "sanity.config": [".ts", ".tsx", ".js", ".jsx"],
  "sanity.cli": [".ts", ".js"],
};

export function isStudioConfigFile(file: string) {
  return Object.entries(FILES).some(([name, extensions]) =>
    extensions.some((ext) => file.endsWith(`${path.sep}${name}${ext}`))
  );
}

const CONFIG_ENTRY = "@visio/sanity/studio";
const CLI_ENTRY = "@visio/sanity/studio/cli";

/** The plugins `defineStudio()` adds, by the module and the name they are imported as. */
const OWN_PLUGINS = new Map([
  ["sanity/structure", "structureTool"],
  ["sanity/presentation", "presentationTool"],
]);

/** The Studio's dependencies the package shares: one version each, from the catalog. */
const SHARED = [
  "sanity",
  "@sanity/types",
  "react",
  "react-dom",
  "styled-components",
];

const CONFIG_FIX = `Write \`export default defineStudio({ title, types: schemaTypes })\` with defineStudio from ${CONFIG_ENTRY} (.claude/skills/sanity/SKILL.md).`;
const CLI_FIX = `Make the whole file \`export { default } from '${CLI_ENTRY}';\`.`;

function where(file: string, source: string, offset: number) {
  return `\n  at ${file}:${source.slice(0, offset).split("\n").length}`;
}

function importedName(spec: ImportDeclarationSpecifier) {
  if (spec.type !== "ImportSpecifier") {
    return;
  }

  return spec.imported.type === "Identifier"
    ? spec.imported.name
    : spec.imported.value;
}

export function localName(
  program: Program,
  module: string,
  name: string
): string | undefined {
  for (const node of program.body) {
    if (node.type === "ImportDeclaration" && node.source.value === module) {
      for (const spec of node.specifiers) {
        if (importedName(spec) === name) {
          return spec.local.name;
        }
      }
    }
  }

  return undefined;
}

function unwrap(expression: Expression): Expression {
  if (
    expression.type === "TSSatisfiesExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "ParenthesizedExpression"
  ) {
    return unwrap(expression.expression);
  }

  return expression;
}

interface DefaultExport {
  value?: Expression;
  start: number;
}

/** The default export as written, or the name it exports when that is a binding. */
function exportedDefault(
  program: Program
): DefaultExport | { name: string | undefined; start: number } {
  let name: string | undefined;
  let start = 0;

  for (const node of program.body) {
    if (node.type === "ExportDefaultDeclaration") {
      ({ start } = node);
      const { declaration } = node;

      if (
        declaration.type === "FunctionDeclaration" ||
        declaration.type === "ClassDeclaration" ||
        declaration.type === "TSInterfaceDeclaration"
      ) {
        return { start };
      }

      const value = unwrap(declaration);

      if (value.type !== "Identifier") {
        return { value, start };
      }

      ({ name } = value);
    } else if (node.type === "ExportNamedDeclaration" && !node.source) {
      for (const spec of node.specifiers) {
        if (
          spec.exported.type === "Identifier" &&
          spec.exported.name === "default" &&
          spec.local.type === "Identifier"
        ) {
          ({ start } = node);
          ({ name } = spec.local);
        }
      }
    }
  }

  return { name, start };
}

function defaultExport(program: Program): DefaultExport | undefined {
  const exported = exportedDefault(program);

  if (!("name" in exported)) {
    return exported;
  }

  const { name, start } = exported;

  if (!name) {
    return undefined;
  }

  for (const node of program.body) {
    const statement =
      node.type === "ExportNamedDeclaration" && node.declaration
        ? node.declaration
        : node;

    if (
      statement.type === "VariableDeclaration" &&
      statement.kind === "const"
    ) {
      for (const declarator of statement.declarations) {
        if (
          declarator.id.type === "Identifier" &&
          declarator.id.name === name &&
          declarator.init
        ) {
          return { value: unwrap(declarator.init), start: node.start };
        }
      }
    }
  }

  return { start };
}

function checkConfig(
  file: string | undefined,
  studioDir: string
): StudioFinding[] {
  if (!file) {
    return [
      {
        level: "error",
        message: `[@visio/sanity] [STUDIO_CONFIG_UNMANAGED] The Studio has no sanity.config.ts, so \`sanity\` has no Studio to build. ${CONFIG_FIX}\n  at ${path.join(studioDir, "sanity.config.ts")}`,
      },
    ];
  }

  const source = readFileSync(file, "utf-8");
  const { program } = parseSync(file, source);
  const findings: StudioFinding[] = [];
  const own = localName(program, CONFIG_ENTRY, "defineStudio");
  const exported = defaultExport(program);
  const call = exported?.value;

  if (
    !own ||
    call?.type !== "CallExpression" ||
    call.callee.type !== "Identifier" ||
    call.callee.name !== own
  ) {
    findings.push({
      level: "error",
      message: `[@visio/sanity] [STUDIO_CONFIG_UNMANAGED] The Studio's config does not export \`defineStudio({ ... })\`, so it misses the project, Presentation on the draft mode routes, and the singletons. ${CONFIG_FIX}${where(file, source, exported?.start ?? 0)}`,
    });
  }

  for (const node of program.body) {
    if (node.type === "ImportDeclaration") {
      const plugin = OWN_PLUGINS.get(node.source.value);

      for (const spec of node.specifiers) {
        if (plugin && importedName(spec) === plugin) {
          findings.push({
            level: "warning",
            message: `[@visio/sanity] [STUDIO_PLUGIN_DUPLICATE] ${spec.local.name}() is imported in the Studio's config, and defineStudio() adds it already. Pass its options to defineStudio() as \`structureTool\` or \`presentationTool\`.${where(file, source, node.start)}`,
          });
        }
      }
    }
  }

  return findings;
}

function checkCli(
  file: string | undefined,
  studioDir: string
): StudioFinding[] {
  if (!file) {
    return [
      {
        level: "error",
        message: `[@visio/sanity] [STUDIO_CLI_UNMANAGED] The Studio has no sanity.cli.ts, so \`sanity\` misses the site's project and the Studio's path, and the Studio's files are not found under it. ${CLI_FIX}\n  at ${path.join(studioDir, "sanity.cli.ts")}`,
      },
    ];
  }

  const source = readFileSync(file, "utf-8");
  const { program } = parseSync(file, source);

  const reexported = program.body.some(
    (node) =>
      node.type === "ExportNamedDeclaration" &&
      node.source?.value === CLI_ENTRY &&
      node.specifiers.some(
        (spec) =>
          spec.exported.type === "Identifier" &&
          spec.exported.name === "default" &&
          spec.local.type === "Identifier" &&
          spec.local.name === "default"
      )
  );

  if (reexported) {
    return [];
  }

  return [
    {
      level: "error",
      message: `[@visio/sanity] [STUDIO_CLI_UNMANAGED] The Studio's CLI config is not visio's, so \`sanity\` misses the site's project, the Studio's path and its one copy of React. ${CLI_FIX}${where(file, source, 0)}`,
    },
  ];
}

function checkDependencies(studioDir: string): StudioFinding[] {
  const file = path.join(studioDir, "package.json");

  if (!existsSync(file)) {
    return [];
  }

  const source = readFileSync(file, "utf-8");

  // SAFETY: a package.json, where both fields map names to version ranges.
  const { dependencies = {}, devDependencies = {} } = JSON.parse(source) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const all = { ...devDependencies, ...dependencies };

  const pinned = SHARED.filter(
    (name) => name in all && all[name] !== "catalog:"
  );

  if (!pinned.length) {
    return [];
  }

  return [
    {
      level: "error",
      message:
        `[@visio/sanity] [STUDIO_DEPENDENCY_UNCATALOGED] The Studio sets its own version of ${pinned.join(", ")}. @visio/sanity takes the catalog's, so two copies install and the Studio's types disagree with defineStudio(). ` +
        `Write "catalog:" for each in studio/package.json; \`bun run visio:update\` keeps the catalog in the root package.json.${where(
          file,
          source,
          source.indexOf(`"${pinned[0]}"`)
        )}`,
    },
  ];
}

export function checkStudio(studioDir: string): StudioFinding[] {
  function file(name: keyof typeof FILES) {
    return FILES[name]
      .map((ext) => path.join(studioDir, name + ext))
      .find(existsSync);
  }

  return [
    ...checkConfig(file("sanity.config"), studioDir),
    ...checkCli(file("sanity.cli"), studioDir),
    ...checkDependencies(studioDir),
  ];
}
