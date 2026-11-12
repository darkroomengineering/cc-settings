/** A value in a field of an oxc-parser AST node. */
export type AstField =
  | string
  | number
  | boolean
  | bigint
  | RegExp
  | null
  | undefined
  | AstRecord
  | AstField[];

export interface AstRecord {
  readonly [key: string]: AstField;
}

export interface AstNode extends AstRecord {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

export function isNode(v: AstField): v is AstNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    typeof v.type === "string" &&
    "start" in v &&
    typeof v.start === "number" &&
    "end" in v &&
    typeof v.end === "number"
  );
}

function isNodeOrNull(v: AstField): v is AstNode | null {
  return v === null || isNode(v);
}

function isRecord(v: AstField): v is AstRecord {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof RegExp)
  );
}

function isText(v: AstField): v is string {
  return typeof v === "string";
}

function broken(node: AstNode, key: string, what: string): never {
  throw new Error(
    `[@visio/styling] ${node.type}.${key} is not ${what}; the parser output changed shape.`
  );
}

export function isProgram(program: unknown): program is AstNode {
  return (
    typeof program === "object" &&
    program !== null &&
    "type" in program &&
    program.type === "Program" &&
    "start" in program &&
    typeof program.start === "number" &&
    "end" in program &&
    typeof program.end === "number"
  );
}

export function child(node: AstNode, key: string): AstNode {
  const v = node[key];

  return isNode(v) ? v : broken(node, key, "a node");
}

export function optChild(node: AstNode, key: string): AstNode | null {
  const v = node[key];

  return isNode(v) ? v : null;
}

export function children(node: AstNode, key: string): AstNode[] {
  const v = node[key];

  if (Array.isArray(v) && v.every(isNode)) {
    return v;
  }

  return broken(node, key, "a list of nodes");
}

export function items(node: AstNode, key: string): (AstNode | null)[] {
  const v = node[key];

  if (Array.isArray(v) && v.every(isNodeOrNull)) {
    return v;
  }

  return broken(node, key, "a list of nodes");
}

export function text(node: AstNode, key: string): string {
  const v = node[key];

  return isText(v) ? v : broken(node, key, "a string");
}

export function optText(node: AstNode, key: string): string | undefined {
  const v = node[key];

  return isText(v) ? v : undefined;
}

export function cooked(element: AstNode): string | null {
  const { value } = element;

  if (!isRecord(value)) {
    return broken(element, "value", "a { raw, cooked } object");
  }

  const { cooked: out } = value;

  return isText(out) ? out : null;
}

export function cookedText(element: AstNode): string {
  return cooked(element) ?? broken(element, "value.cooked", "a string");
}

export function childNodes(node: AstNode): { key: string; node: AstNode }[] {
  const out: { key: string; node: AstNode }[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          out.push({ key, node: item });
        }
      }
    } else if (isNode(value)) {
      out.push({ key, node: value });
    }
  }

  return out;
}
