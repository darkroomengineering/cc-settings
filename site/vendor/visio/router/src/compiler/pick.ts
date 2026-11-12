import { MagicString } from "magic-string";
import { parseSync } from "oxc-parser";

import {
  child,
  children,
  declaredNames,
  exportedNames,
  hasName,
  isIdentifier,
  programBody,
  specifierName,
  walk,
} from "./ast.ts";
import type { AstNode } from "./ast.ts";

export interface PickResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
}

interface Statement {
  node: AstNode;
  /** Names this statement binds at module scope. */
  declares: string[];
  /** Identifier names the statement mentions, outside type positions. */
  refs: Set<string>;
  keep: boolean;
  /** Text edits to apply when kept: [start, end] ranges to remove. */
  trims: [number, number][];
  /** The statement's text when kept, in place of the source. */
  replacement?: string;
}

/** Top-level statements the sweep keeps only when something kept refers to them. */
const DECLARATIONS = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSEnumDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSModuleDeclaration",
  "TSDeclareFunction",
  "TSImportEqualsDeclaration",
]);

/**
 * Type-position nodes: `TSTypeReference`, `TSStringKeyword`, an interface.
 * Runtime nodes such as `TSAsExpression`, `TSInstantiationExpression`,
 * `TSTypeAssertion` and enums do not match, so their expressions count.
 */
const TYPE_NODE =
  /^TS(?:Type(?!Assertion)|Interface|ClassImplements|IndexSignature|DeclareFunction)|^TS\w*(?:Type|Keyword)$/v;

/**
 * The binding a JSX tag refers to: `<Hero>` is Hero, `<UI.Card>` is UI.
 * Intrinsic and namespaced tags bind nothing, and a stray match on one only
 * keeps a little too much.
 */
function jsxTagRoot(name: AstNode | undefined): string | undefined {
  let n = name;

  while (n?.type === "JSXMemberExpression") {
    n = child(n, "object");
  }

  return n?.type === "JSXIdentifier" && hasName(n) ? n.name : undefined;
}

function refsOf(node: AstNode): Set<string> {
  const refs = new Set<string>();
  walk(node, (n) => {
    // Types are erased; a reference there must not keep a runtime binding.
    if (TYPE_NODE.test(n.type)) {
      return false;
    }

    if (isIdentifier(n)) {
      refs.add(n.name);
    }

    // Before the JSX transform a tag is the only mention of its component.
    if (n.type === "JSXOpeningElement" || n.type === "JSXClosingElement") {
      const root = jsxTagRoot(child(n, "name"));

      if (root) {
        refs.add(root);
      }
    }
  });

  return refs;
}

/**
 * An `export default`: kept when picked. Otherwise dropped entirely, unless
 * it is a named declaration another kept statement might refer to; then it
 * stays as a plain declaration.
 */
function markDefault(st: Statement, picked: boolean): void {
  if (picked) {
    st.keep = true;

    return;
  }

  const decl = child(st.node, "declaration");

  const named =
    (decl?.type === "FunctionDeclaration" ||
      decl?.type === "ClassDeclaration") &&
    child(decl, "id");

  if (decl && named) {
    st.trims.push([st.node.start, decl.start]);
  } else {
    st.declares = [];
    st.refs = new Set();
  }
}

function markNamed(
  st: Statement,
  code: string,
  wanted: ReadonlySet<string>,
  exported: readonly string[]
): void {
  const { node } = st;
  const picked = exported.some((name) => wanted.has(name));
  const unpicked = exported.some((name) => !wanted.has(name));
  const decl = child(node, "declaration");

  if (decl) {
    if (picked) {
      st.keep = true;
    } else {
      st.trims.push([node.start, decl.start]);
    }

    return;
  }

  if (!(picked && unpicked)) {
    st.keep = picked;

    return;
  }

  // `export { a, b }`: keep only the picked names.
  const specs = children(node, "specifiers").filter((spec) => {
    const name = specifierName(child(spec, "exported"));

    return name !== undefined && wanted.has(name);
  });

  const source = child(node, "source");
  const from = source ? ` from ${code.slice(source.start, source.end)}` : "";
  st.replacement = `export { ${specs.map((spec) => code.slice(spec.start, spec.end)).join(", ")} }${from};`;
  st.refs = new Set(
    specs.flatMap((spec) => specifierName(child(spec, "local")) ?? [])
  );
  st.keep = true;
}

function mark(st: Statement, code: string, wanted: ReadonlySet<string>): void {
  const { node } = st;
  const exported = exportedNames(node);

  switch (node.type) {
    case "ExportDefaultDeclaration": {
      markDefault(
        st,
        exported.some((name) => wanted.has(name))
      );
      break;
    }

    case "ExportNamedDeclaration": {
      markNamed(st, code, wanted, exported);
      break;
    }

    case "ExportAllDeclaration": {
      // `export * from` runs the module's side effects, so it stays in every pick.
      const name = specifierName(child(node, "exported"));
      st.keep = name === undefined || wanted.has(name);
      break;
    }

    // Side effects stay: every statement that is not a declaration, and bare imports.
    case "ImportDeclaration": {
      st.keep = children(node, "specifiers").length === 0;
      break;
    }

    default: {
      st.keep = !DECLARATIONS.has(node.type);
    }
  }
}

/** Keeps every declaration a kept statement refers to, to a fixpoint. */
function sweep(statements: readonly Statement[]): void {
  let changed = true;

  while (changed) {
    changed = false;
    const referenced = new Set<string>();

    for (const st of statements) {
      if (st.keep) {
        for (const r of st.refs) {
          referenced.add(r);
        }
      }
    }

    for (const st of statements) {
      if (st.keep || st.declares.length === 0) {
        continue;
      }

      if (st.declares.some((name) => referenced.has(name))) {
        st.keep = true;
        changed = true;
      }
    }
  }
}

/** Keeps `picks` of the module's exports and whatever they need. */
export function pickExports(
  code: string,
  file: string,
  picks: readonly string[]
): PickResult {
  const { program } = parseSync(file, code);
  const wanted = new Set(picks);

  const statements: Statement[] = programBody(program).map((node) => ({
    node,
    declares: declaredNames(node),
    refs: refsOf(node),
    keep: false,
    trims: [],
  }));

  for (const st of statements) {
    mark(st, code, wanted);
  }

  sweep(statements);

  const s = new MagicString(code);

  for (const st of statements) {
    if (!st.keep) {
      s.remove(st.node.start, st.node.end);
      continue;
    }

    if (st.replacement !== undefined) {
      s.overwrite(st.node.start, st.node.end, st.replacement);
      continue;
    }

    for (const [start, end] of st.trims) {
      s.remove(start, end);
    }
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: file, includeContent: false }),
  };
}
