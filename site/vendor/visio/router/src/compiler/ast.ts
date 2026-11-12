/** The little of the oxc ESTree output the compiler reads. */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface Identifier extends AstNode {
  type: "Identifier";
  name: string;
}

export interface CallExpression extends AstNode {
  type: "CallExpression";
  callee: AstNode;
  arguments: AstNode[];
}

export function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "start" in value &&
    typeof value.start === "number" &&
    "end" in value &&
    typeof value.end === "number"
  );
}

/** The top-level statements of a module oxc parsed. */
export function programBody(program: { body: readonly object[] }): AstNode[] {
  return program.body.filter(isNode);
}

/** The nodes of the list at `key`, without its holes. */
export function children(node: AstNode | undefined, key: string): AstNode[] {
  const value = node?.[key];

  return Array.isArray(value) ? value.filter(isNode) : [];
}

/** The node at `key`, when there is one. */
export function child(
  node: AstNode | undefined,
  key: string
): AstNode | undefined {
  const value = node?.[key];

  return isNode(value) ? value : undefined;
}

/** The items of an array literal, `undefined` for a hole. */
export function elements(node: AstNode): (AstNode | undefined)[] {
  const value = node.elements;

  return Array.isArray(value)
    ? value.map((item) => (isNode(item) ? item : undefined))
    : [];
}

/** Depth first, parent before children. Return false from `visit` to skip a subtree. */
export function walk(
  n: AstNode | readonly AstNode[],
  visit: (node: AstNode) => boolean | undefined
): void {
  if (!("type" in n)) {
    for (const c of n) {
      walk(c, visit);
    }

    return;
  }

  if (visit(n) === false) {
    return;
  }

  for (const [key, value] of Object.entries(n)) {
    if (key === "type" || key === "start" || key === "end") {
      continue;
    }

    if (isNode(value)) {
      walk(value, visit);
    } else if (Array.isArray(value)) {
      walk(value.filter(isNode), visit);
    }
  }
}

/** A node with a `name`: an identifier, a JSX identifier. */
export function hasName(
  n: AstNode | undefined
): n is AstNode & { name: string } {
  return typeof n?.name === "string";
}

export function isIdentifier(n: AstNode | undefined): n is Identifier {
  return n?.type === "Identifier" && hasName(n);
}

export function isCall(n: AstNode | undefined): n is CallExpression {
  return (
    n?.type === "CallExpression" &&
    isNode(n.callee) &&
    Array.isArray(n.arguments)
  );
}

function isTemplateValue(
  value: unknown
): value is { cooked?: string | null; raw: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    typeof value.raw === "string"
  );
}

function quasiText(quasi: AstNode | undefined): string | undefined {
  const value = quasi?.value;

  return isTemplateValue(value) ? (value.cooked ?? value.raw) : undefined;
}

function isStringLiteral(
  n: AstNode | undefined
): n is AstNode & { value: string } {
  return n?.type === "Literal" && typeof n.value === "string";
}

export function stringValue(n: AstNode | undefined): string | undefined {
  if (isStringLiteral(n)) {
    return n.value;
  }

  if (n?.type === "TemplateLiteral") {
    const quasis = children(n, "quasis");

    if (children(n, "expressions").length === 0 && quasis.length === 1) {
      return quasiText(quasis[0]);
    }
  }

  return undefined;
}

/** The name a module specifier spells: `x` in `{ x as y }` or in `{ 'x' as y }`. */
export function specifierName(n: AstNode | undefined): string | undefined {
  if (isIdentifier(n)) {
    return n.name;
  }

  if (n?.type === "Literal") {
    return String(n.value);
  }

  return undefined;
}

/** Names bound by a pattern: identifiers, destructuring, rest, defaults. */
export function bindingNames(
  pattern: AstNode | undefined,
  out: string[] = []
): string[] {
  if (isIdentifier(pattern)) {
    out.push(pattern.name);

    return out;
  }

  switch (pattern?.type) {
    case "ObjectPattern": {
      for (const p of children(pattern, "properties")) {
        bindingNames(
          child(p, p.type === "RestElement" ? "argument" : "value"),
          out
        );
      }

      break;
    }

    case "ArrayPattern": {
      for (const e of children(pattern, "elements")) {
        bindingNames(e, out);
      }

      break;
    }

    case "AssignmentPattern": {
      bindingNames(child(pattern, "left"), out);
      break;
    }

    case "RestElement": {
      bindingNames(child(pattern, "argument"), out);
      break;
    }

    default: {
      break;
    }
  }

  return out;
}

/** Names a top-level statement binds at module scope, through its `export` if it has one. */
export function declaredNames(node: AstNode): string[] {
  const decl =
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportDefaultDeclaration"
      ? child(node, "declaration")
      : node;

  if (!decl) {
    return [];
  }

  switch (decl.type) {
    case "VariableDeclaration": {
      return children(decl, "declarations").flatMap((d) =>
        bindingNames(child(d, "id"))
      );
    }

    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSEnumDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSModuleDeclaration":
    case "TSImportEqualsDeclaration": {
      const id = child(decl, "id");

      return isIdentifier(id) ? [id.name] : [];
    }

    case "ImportDeclaration": {
      return children(decl, "specifiers").flatMap((s) => {
        const local = child(s, "local");

        return isIdentifier(local) ? [local.name] : [];
      });
    }

    default: {
      return [];
    }
  }
}

/** Names a top-level statement exports: `default`, its declarations, or its specifiers. */
export function exportedNames(node: AstNode): string[] {
  if (node.type === "ExportDefaultDeclaration") {
    return ["default"];
  }

  if (node.type !== "ExportNamedDeclaration") {
    return [];
  }

  if (child(node, "declaration")) {
    return declaredNames(node);
  }

  return children(node, "specifiers").flatMap(
    (s) => specifierName(child(s, "exported")) ?? []
  );
}

export function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}
