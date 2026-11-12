import type {
  ArrayTypeNode,
  ObjectAttribute,
  ObjectTypeNode,
  SchemaType,
  TypeNode,
} from "groq-js";

import { queryType } from "./param-access.ts";
import type { FoundQuery } from "./queries.ts";

const REFERENCE = "internalGroqTypeReferenceTo";
const REGISTRY = "SanityQueries";
const ARRAY_OF = "ArrayOf";
const RESERVED = new Set([REFERENCE, REGISTRY, ARRAY_OF]);

type SchemaEntry = SchemaType[number];

type Node = TypeNode | SchemaEntry;

/** `sanity.imageAsset` is `SanityImageAsset`, `my-type` is `MyType`; clashes get `_2`. */
function identifierFor(name: string, taken: Set<string>): string {
  const sanitized = name
    .replace(/^\d/v, "_")
    .replaceAll(/[^$\w]+(?<next>.)/gv, (_, c: string) => c.toUpperCase());

  const desired = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
  let result = desired;

  for (let i = 2; taken.has(result) || RESERVED.has(result); i += 1) {
    result = `${desired}_${i}`;
  }

  return result;
}

/** `PAGE_QUERY` is `PAGE_QUERY_RESULT`, `pageQuery` is `pageQueryResult`. */
function resultName(variable: string): string {
  if (/^[a-z][A-Za-z0-9]*$/v.test(variable)) {
    return `${variable}Result`;
  }

  if (/^[A-Z0-9_]+$/v.test(variable)) {
    return `${variable}_RESULT`;
  }

  if (/^[a-z0-9_]+$/v.test(variable) && variable.includes("_")) {
    return `${variable}_result`;
  }

  return `${variable.replaceAll(/[^A-Za-z0-9]/gv, "")}Result`;
}

function key(name: string) {
  return /^[a-zA-Z_$][\w$]*$/v.test(name) ? name : JSON.stringify(name);
}

function indent(text: string) {
  return text.replaceAll("\n", "\n  ");
}

class Printer {
  readonly ids = new Map<string, string>();
  /** Schema types that something printed so far refers to, by schema name. */
  readonly reached = new Set<string>();
  arrayOfUsed = false;

  readonly schema: SchemaType;

  constructor(schema: SchemaType) {
    this.schema = schema;
    const names = new Set<string>();

    for (const entry of schema) {
      if (names.has(entry.name)) {
        throw new Error(`Duplicate type name "${entry.name}" in the schema.`);
      }

      names.add(entry.name);
    }

    const taken = new Set<string>();

    for (const entry of schema) {
      const id = identifierFor(entry.name, taken);
      taken.add(id);
      this.ids.set(entry.name, id);
    }
  }

  type(node: Node): string {
    switch (node.type) {
      case "array": {
        return this.array(node);
      }

      case "boolean":
      case "number": {
        return node.value === undefined ? node.type : String(node.value);
      }

      case "string": {
        return node.value === undefined ? "string" : JSON.stringify(node.value);
      }

      case "null": {
        return "null";
      }

      case "unknown": {
        return "unknown";
      }

      case "inline": {
        return this.inline(node.name);
      }

      case "document": {
        return this.object(Object.entries(node.attributes));
      }

      case "type": {
        return this.type(node.value);
      }

      case "object": {
        return this.objectNode(node);
      }

      case "union": {
        const [first, ...others] = node.of;

        if (!first) {
          return "never";
        }

        if (others.length === 0) {
          return this.type(first);
        }

        return node.of.map((member) => this.type(member)).join(" | ");
      }

      default: {
        throw new Error(
          `[@visio/sanity] typegen cannot print the type node ${JSON.stringify(node satisfies never)}.`
        );
      }
    }
  }

  private inline(name: string): string {
    const id = this.ids.get(name);

    if (id) {
      this.reached.add(name);
    }

    return (
      id ??
      `unknown /* Unable to locate the referenced type "${name}" in schema */`
    );
  }

  private property([name, attribute]: [string, ObjectAttribute]): string {
    return `${key(name)}${attribute.optional ? "?" : ""}: ${this.type(attribute.value)};`;
  }

  private object(
    attributes: [string, ObjectAttribute][],
    extra: string[] = []
  ): string {
    const lines = [
      ...attributes.map((entry) => this.property(entry)),
      ...extra,
    ];

    return lines.length ? `{\n  ${lines.map(indent).join("\n  ")}\n}` : "{}";
  }

  private objectNode(node: ObjectTypeNode): string {
    const attributes = Object.entries(node.attributes);
    const { rest } = node;

    if (rest?.type === "unknown") {
      return "unknown";
    }

    if (rest?.type === "inline") {
      const resolved = this.inline(rest.name);

      if (resolved.startsWith("unknown")) {
        return resolved;
      }

      return `${this.object(attributes)} & ${resolved}`;
    }

    if (rest?.type === "object") {
      attributes.push(...Object.entries(rest.attributes));
    }

    const extra = node.dereferencesTo
      ? [`[${REFERENCE}]?: ${JSON.stringify(node.dereferencesTo)};`]
      : [];

    return this.object(attributes, extra);
  }

  private array(node: ArrayTypeNode): string {
    const { of } = node;

    if (of.type === "inline") {
      return this.arrayOf(of);
    }

    if (of.type !== "union" || of.of.every((m) => m.type !== "inline")) {
      return `Array<${this.type(of)}>`;
    }

    if (of.of.every((m) => m.type === "inline")) {
      return this.arrayOf(of);
    }

    // Some members are inline, some are not: an array of each.
    const union = of;

    function split(inline: boolean): ArrayTypeNode {
      return {
        ...node,
        of: {
          ...union,
          of: union.of.filter((m) => (m.type === "inline") === inline),
        },
      };
    }

    return `${this.array(split(false))} | ${this.array(split(true))}`;
  }

  private arrayOf(of: TypeNode): string {
    this.arrayOfUsed = true;

    return `${ARRAY_OF}<${this.type(of)}>`;
  }
}

export interface QuerySource {
  /** The file the queries came from, relative to the site, for the comment. */
  file: string;
  queries: FoundQuery[];
}

export interface Printed {
  code: string;
  queries: number;
  errors: string[];
}

export function print(
  schema: SchemaType,
  sources: QuerySource[],
  header = ""
): Printed {
  const printer = new Printer(schema);

  const taken = new Set(printer.ids.values());
  const queryTypes: string[] = [];
  const registry = new Map<string, string[]>();
  const errors: string[] = [];

  for (const { file, queries } of sources) {
    for (const { name, query } of queries) {
      let type: string;

      try {
        type = printer.type(queryType(query, schema));
      } catch (error) {
        errors.push(
          `${file}: ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      const id = identifierFor(resultName(name), taken);
      taken.add(id);
      const oneLine = query.replaceAll(/\r\n|\n|\r/gv, "").trim();
      queryTypes.push(
        `// Source: ${file}\n// Variable: ${name}\n// Query: ${oneLine}\nexport type ${id} = ${type};`
      );
      registry.set(query, [...(registry.get(query) ?? []), id]);
    }
  }

  // The schema types the results reach, and the ones those reach in turn.
  const printed = new Map<string, string>();

  for (let grew = true; grew;) {
    grew = false;

    for (const entry of schema) {
      if (printer.reached.has(entry.name) && !printed.has(entry.name)) {
        printed.set(entry.name, printer.type(entry));
        grew = true;
      }
    }
  }

  const schemaTypes = schema
    .filter((entry) => printed.has(entry.name))
    .map(
      (entry) =>
        `export type ${printer.ids.get(entry.name)} = ${printed.get(entry.name)};`
    );

  const parts = [
    header,
    `export declare const ${REFERENCE}: unique symbol;`,
    printer.arrayOfUsed
      ? `type ${ARRAY_OF}<T> = Array<T & {\n  _key: string;\n}>;`
      : "",
    ...schemaTypes,
    ...queryTypes,
    registry.size
      ? `declare global {\n  interface ${REGISTRY} {\n${[...registry]
          .map(
            ([query, ids]) =>
              `    ${JSON.stringify(query)}: ${ids.join(" | ")};`
          )
          .join("\n")}\n  }\n}`
      : "",
  ];

  return {
    code: `${parts.filter(Boolean).join("\n\n")}\n`,
    queries: queryTypes.length,
    errors,
  };
}
