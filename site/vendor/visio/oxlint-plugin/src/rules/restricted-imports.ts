import { stringValue } from "../ast.ts";
import { matchesAny, matchesGlob, projectPath } from "../paths.ts";
import type { AstNode, NodeOf, Rule } from "../types.ts";

export type Zone = {
  /** Globs from the config's directory, as in an override's `files`. */
  files: string[];
  /** Files under `files` the ban leaves alone. */
  except?: string[];
  imports: BannedImport[];
};

type BannedImport = {
  /** A package name, which bans its subpaths too, or a glob (DESIGN.md). */
  name: string;
  /** Only these named imports; without it, the whole module. */
  importNames?: string[];
  /** Says why and names the fix, for the agent that reads it. */
  message: string;
};

const GLOB = /[*?{]/u;

function matchesName(specifier: string, name: string): boolean {
  if (GLOB.test(name)) {
    return matchesGlob(specifier, name);
  }

  return specifier === name || specifier.startsWith(`${name}/`);
}

type Source =
  | NodeOf<"ImportDeclaration">
  | NodeOf<"ExportNamedDeclaration">
  | NodeOf<"ExportAllDeclaration">;

function moduleName(node: AstNode): string {
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "Literal") {
    return String(node.value);
  }

  return "";
}

type Specifier = NodeOf<"ImportDeclaration">["specifiers"][number];

function specifierName(specifier: Specifier): string {
  if (specifier.type === "ImportSpecifier") {
    return moduleName(specifier.imported);
  }

  return specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
}

function importedNames(node: Source): string[] {
  if (node.type === "ExportAllDeclaration") {
    return ["*"];
  }

  if (node.type === "ExportNamedDeclaration") {
    return node.specifiers.map((specifier) => moduleName(specifier.local));
  }

  return node.specifiers.map(specifierName);
}

export const restrictedImports: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Bans imports per folder, from one map, so no override replaces another ban on the same files.",
    },
    schema: [
      {
        type: "object",
        properties: {
          zones: {
            type: "array",
            items: {
              type: "object",
              properties: {
                files: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                },
                except: { type: "array", items: { type: "string" } },
                imports: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", minLength: 1 },
                      importNames: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 1,
                      },
                      message: { type: "string", minLength: 1 },
                    },
                    required: ["name", "message"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["files", "imports"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      banned: "'{{specifier}}' is not allowed here. {{message}}",
      bannedName:
        "'{{name}}' from '{{specifier}}' is not allowed here. {{message}}",
    },
  },
  create(context) {
    // SAFETY: oxlint checks the options against the schema above before create() runs.
    const options = context.options[0] as { zones?: Zone[] } | undefined;
    const path = projectPath(context);

    const bans = (options?.zones ?? [])
      .filter(
        (zone) =>
          matchesAny(path, zone.files) && !matchesAny(path, zone.except ?? [])
      )
      .flatMap((zone) => zone.imports);

    if (bans.length === 0) {
      return {};
    }

    function check(node: AstNode, specifier: string, names?: string[]): void {
      for (const ban of bans) {
        if (!matchesName(specifier, ban.name)) {
          continue;
        }

        if (!ban.importNames) {
          context.report({
            node,
            messageId: "banned",
            data: { specifier, message: ban.message },
          });
          continue;
        }

        // A namespace import, `export *` and a dynamic import reach every name;
        // `import 'x'` reaches none.
        const banned = ban.importNames;

        for (const hit of (names ?? ["*"]).filter(
          (name) => name === "*" || banned.includes(name)
        )) {
          const name = hit === "*" ? banned.join(", ") : hit;
          context.report({
            node,
            messageId: "bannedName",
            data: { name, specifier, message: ban.message },
          });
        }
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value, importedNames(node));
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node, node.source.value, importedNames(node));
        }
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value, ["*"]);
      },
      ImportExpression(node) {
        const specifier = stringValue(node.source);

        if (specifier !== undefined) {
          check(node, specifier);
        }
      },
    };
  },
};
