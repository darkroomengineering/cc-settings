import type { AstNode, NodeOf } from "./types.ts";

type Program = NodeOf<"Program">;

export function importedBindings(program: Program): Map<string, string> {
  const bindings = new Map<string, string>();

  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.importKind === "type"
      ) {
        continue;
      }

      bindings.set(specifier.local.name, statement.source.value);
    }
  }

  return bindings;
}

export function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

export function staticKey(node: AstNode): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }

  return stringValue(node);
}

export function stringValue(node: AstNode): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  return undefined;
}

export function intrinsicTag(
  node: NodeOf<"JSXOpeningElement">
): string | undefined {
  const { name } = node;

  return name.type === "JSXIdentifier" && /^[a-z]/u.test(name.name)
    ? name.name
    : undefined;
}

export function findAttribute(
  node: NodeOf<"JSXOpeningElement">,
  name: string
): NodeOf<"JSXAttribute"> | undefined {
  for (const attribute of node.attributes) {
    if (
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name
    ) {
      return attribute;
    }
  }

  return undefined;
}

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// Arrows and functions: oxlint types the three kinds of function as one node.
export type Fn = Extract<AstNode, { params: unknown; body: unknown }>;

export function isFunction(node: AstNode): node is Fn {
  return FUNCTIONS.has(node.type);
}

const DEFINERS = new Set(["defineRoute", "defineLayout"]);

/** The `preload` function of a `defineRoute()` or `defineLayout()` call. */
export function preloadOf(call: NodeOf<"CallExpression">): Fn | undefined {
  if (call.callee.type !== "Identifier" || !DEFINERS.has(call.callee.name)) {
    return undefined;
  }

  const [, options] = call.arguments;

  if (options?.type !== "ObjectExpression") {
    return undefined;
  }

  for (const property of options.properties) {
    if (
      property.type === "Property" &&
      !property.computed &&
      staticKey(property.key) === "preload" &&
      (property.value.type === "ArrowFunctionExpression" ||
        property.value.type === "FunctionExpression") &&
      property.value.body
    ) {
      return property.value;
    }
  }

  return undefined;
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/**
 * Calls `visit` on every node under `node`, without entering nested
 * functions, whose statements belong to another body.
 */
export function walkBody(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") {
      continue;
    }

    const children: unknown[] = Array.isArray(value) ? value : [value];

    for (const child of children) {
      if (isNode(child) && !FUNCTIONS.has(child.type)) {
        walkBody(child, visit);
      }
    }
  }
}
