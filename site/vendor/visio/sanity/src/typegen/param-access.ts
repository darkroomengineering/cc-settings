import { parse, typeEvaluate, unparse } from "groq-js";
import type {
  ExprNode,
  ObjectAttribute,
  ParseOptions,
  SchemaType,
  TypeNode,
} from "groq-js";

const MARK = "$visio:param:";

/** The name a `[$param]` takes, so the parser gives only it a value. */
const RENAMED = "visio__";

/** A node of the AST, read field by field: the walk does not know its kind. */
interface Node {
  readonly type: string;
}

interface Slot {
  parent: Node;
  set: (next: Node) => void;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Each node under `node`, with the slot it sits in. */
function slots(node: Node): [Node, Slot][] {
  // A constant's value is data, not nodes.
  if (node.type === "Value") {
    return [];
  }

  const out: [Node, Slot][] = [];

  for (const [name, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        if (isNode(item)) {
          out.push([item, { parent: node, set: (next) => (value[i] = next) }]);
        }
      }
    } else if (isNode(value)) {
      out.push([
        value,
        { parent: node, set: (next) => Object.assign(node, { [name]: next }) },
      ]);
    }
  }

  return out;
}

function field(node: Node, name: string): unknown {
  return Object.getOwnPropertyDescriptor(node, name)?.value;
}

function paramOf(node: Node): string | undefined {
  const expr = field(node, "expr");

  return node.type === "Filter" && isNode(expr) && expr.type === "Parameter"
    ? String(field(expr, "name"))
    : undefined;
}

/**
 * The query with each `x[$param]`, and what follows it in its chain
 * (`x[$param].y`), replaced by an object that holds the type of `x`: the
 * parser made the chain a traversal, which would lose that type.
 */
function probe(ast: ExprNode): ExprNode | undefined {
  const copy = structuredClone(ast);
  const parents = new Map<Node, Slot>();
  const filters: Node[] = [];

  function walk(node: Node) {
    for (const [child, slot] of slots(node)) {
      parents.set(child, slot);
      walk(child);
    }

    if (paramOf(node) !== undefined) {
      filters.push(node);
    }
  }

  walk(copy);
  const replaced = new Set<Node>();

  for (const filter of filters) {
    let top = filter;
    let slot = parents.get(top);

    while (slot && field(slot.parent, "base") === top) {
      top = slot.parent;
      slot = parents.get(top);
    }

    // An outer `[$param]` in a chain an inner one has replaced keeps the filter type.
    if (!slot || replaced.has(top)) {
      continue;
    }

    replaced.add(top);

    const mark = {
      type: "Object",
      attributes: [
        {
          type: "ObjectAttributeValue",
          name: MARK + paramOf(filter),
          value: field(filter, "base"),
        },
      ],
    };

    slot.set(mark);
  }

  return replaced.size ? copy : undefined;
}

/** The types the probe's marks hold, by param. */
function marked(type: TypeNode, out: Map<string, TypeNode[]>): void {
  if (type.type === "union") {
    for (const member of type.of) {
      marked(member, out);
    }
  } else if (type.type === "array") {
    marked(type.of, out);
  } else if (type.type === "object") {
    for (const [name, attribute] of Object.entries(type.attributes)) {
      if (name.startsWith(MARK)) {
        const param = name.slice(MARK.length);
        out.set(param, [...(out.get(param) ?? []), attribute.value]);
      } else {
        marked(attribute.value, out);
      }
    }
  }
}

/** The keys of the objects `types` can be; undefined when one can be anything else. */
function keysOf(
  types: readonly TypeNode[],
  schema: SchemaType
): string[] | undefined {
  const keys = new Set<string>();
  const stack = [...types];
  let objects = 0;

  for (let type = stack.pop(); type; type = stack.pop()) {
    if (type.type === "union") {
      stack.push(...type.of);
    } else if (type.type === "inline") {
      const { name } = type;
      const entry = schema.find((candidate) => candidate.name === name);

      if (entry?.type !== "type") {
        return undefined;
      }

      stack.push(entry.value);
    } else if (type.type === "object") {
      objects += 1;

      for (const key of Object.keys(type.attributes)) {
        // `_type` and `_key` are not a value a param picks.
        if (!key.startsWith("_")) {
          keys.add(key);
        }
      }
    } else if (type.type !== "null") {
      return undefined;
    }
  }

  return objects && keys.size ? [...keys] : undefined;
}

function same<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function members(type: TypeNode): TypeNode[] {
  return type.type === "union" ? type.of : [type];
}

/** One type for two parses of one query: they differ only where the param picked a key. */
function merge(a: TypeNode, b: TypeNode): TypeNode {
  if (same(a, b)) {
    return a;
  }

  if (a.type === "array" && b.type === "array") {
    return { type: "array", of: merge(a.of, b.of) };
  }

  if (a.type === "union" && b.type === "union" && a.of.length === b.of.length) {
    return { type: "union", of: a.of.map((t, i) => merge(t, b.of[i] ?? t)) };
  }

  if (
    a.type === "object" &&
    b.type === "object" &&
    same(Object.keys(a.attributes), Object.keys(b.attributes)) &&
    same(a.rest, b.rest) &&
    a.dereferencesTo === b.dereferencesTo
  ) {
    const attributes: Record<string, ObjectAttribute> = {};

    for (const [name, left] of Object.entries(a.attributes)) {
      const right = b.attributes[name] ?? left;

      const attribute: ObjectAttribute = {
        type: "objectAttribute",
        value: merge(left.value, right.value),
      };

      if (left.optional || right.optional) {
        attribute.optional = true;
      }

      attributes[name] = attribute;
    }

    return { ...a, attributes };
  }

  const of: TypeNode[] = [];

  for (const member of [...members(a), ...members(b)]) {
    if (!of.some((kept) => same(kept, member))) {
      of.push(member);
    }
  }

  return { type: "union", of };
}

/** The AST with each `[$param]` of `params` under its new name. */
function renamed(ast: ExprNode, params: ReadonlySet<string>): ExprNode {
  const copy = structuredClone(ast);

  function walk(node: Node) {
    for (const [child] of slots(node)) {
      walk(child);
    }

    const param = paramOf(node);
    const expr = field(node, "expr");

    if (param !== undefined && params.has(param) && isNode(expr)) {
      Object.assign(expr, { name: RENAMED + param });
    }
  }

  walk(copy);

  return copy;
}

/** Every combination of one key per param, under its new name. */
function combinations(
  keyed: readonly (readonly [string, readonly string[]])[]
): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];

  for (const [param, keys] of keyed) {
    out = out.flatMap((values) =>
      keys.map((key) => ({ ...values, [RENAMED + param]: key }))
    );
  }

  return out;
}

/**
 * Slice parameters (`[$start...$end]`) must be numbers for the parser; their
 * value does not matter to the types.
 */
function sliceParams(query: string): ParseOptions["params"] {
  const params: Record<string, number> = {};

  for (const match of query.matchAll(
    /\[\s*(?:\$(?<from>\w+)|\d+)\s*\.\.\.?\s*(?:\$(?<to>\w+)|\d+)\s*\]/gv
  )) {
    const { from, to } = match.groups ?? {};

    if (from) {
      params[from] = 0;
    }

    if (to) {
      params[to] = 0;
    }
  }

  return params;
}

export function queryType(query: string, schema: SchemaType): TypeNode {
  const params = sliceParams(query);
  const ast: ExprNode = parse(query, { params });
  const probed = probe(ast);

  if (!probed) {
    return typeEvaluate(ast, schema);
  }

  const found = new Map<string, TypeNode[]>();
  marked(typeEvaluate(probed, schema), found);

  const keyed = [...found].flatMap(([param, types]) => {
    const keys = keysOf(types, schema);

    return keys ? [[param, keys] as const] : [];
  });

  if (!keyed.length) {
    return typeEvaluate(ast, schema);
  }

  // Only the brackets get the key: `$lang` anywhere else stays a param.
  const text = unparse(renamed(ast, new Set(keyed.map(([param]) => param))));
  // keysOf() gives at least one key, so there is at least one combination.
  const [first = {}, ...rest] = combinations(keyed);
  let type = typeEvaluate(parse(text, { params: first }), schema);

  for (const values of rest) {
    type = merge(type, typeEvaluate(parse(text, { params: values }), schema));
  }

  return type;
}
