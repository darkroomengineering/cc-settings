import { decode } from "html-entities";
import { MagicString } from "magic-string";
import { parseSync } from "oxc-parser";

import { isBoolean, isNumber, isString } from "../guards.ts";
import { kebab } from "../helpers.ts";
import type { CssVarSpec } from "../helpers.ts";
import type { CompiledRecipe, Layer } from "../runtime.ts";
import {
  child,
  childNodes,
  children,
  cooked,
  cookedText,
  items,
  optChild,
  optText,
  isProgram,
  text,
} from "./ast.ts";
import type { AstNode } from "./ast.ts";
import { hash, propKey, propOf } from "./atomize.ts";
import type { AtomRegistry } from "./atomize.ts";
import type { GlobalRule, Keyframes, PropertyRegistration } from "./emit.ts";
import { error as errorAt, warning } from "./errors.ts";
import type { Diagnostic } from "./errors.ts";
import {
  EvalError,
  evaluateStyle,
  evaluateValue,
  isTokens,
  unwrap,
} from "./evaluate.ts";
import type { EvalContext, HelperName } from "./evaluate.ts";
import { applyIgnores, collectDirectives, lineStartsOf } from "./ignore.ts";
import type { IgnoreDirective } from "./ignore.ts";
import type { Declaration, SourceSpan, StyleObject } from "./model.ts";
import { hasErrors, normalize } from "./normalize.ts";
import { LAYOUT_PROPS } from "./props.ts";
import { mentionsHover } from "./selector.ts";

const PACKAGE = "@visio/styling";

const RECIPE_KEYS = ["base", "variants", "compound", "defaults"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A `css.recipe()` argument once its shape is checked. */
interface RecipeDef {
  base?: StyleObject;
  variants?: Record<string, Record<string, StyleObject>>;
  compound?: { when: Record<string, string | boolean>; style: StyleObject }[];
  defaults?: Record<string, string | boolean>;
}

interface CompiledStyle {
  classes: string[];
  layer: Layer;
}

const RUNTIME_IMPORT = `import { recipe as __visioRecipe } from "@visio/styling/internal/runtime";\n`;

export interface ExtractOptions {
  /** Path used in diagnostics, usually relative to the project root. */
  file: string;
  /** Path recorded in the source map. Defaults to `file`. */
  sourcePath?: string;
  code: string;
  tokenExports: Record<string, unknown> | null;
  isTokensImport: (source: string) => boolean;
  typography: "open" | "strict";
  /** Floor scaled font sizes at this many px. The project passes `A11Y.minFontSize`. */
  fontFloor?: number;
  conditions: Record<string, string>;
  registry: AtomRegistry;
}

export interface ExtractResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
  changed: boolean;
  diagnostics: Diagnostic[];
  declarations: Declaration[];
  globals: GlobalRule[];
  keyframes: Keyframes[];
  properties: PropertyRegistration[];
  /** Dotted token paths referenced anywhere in the file, e.g. `colors.accent`. */
  tokenRefs: string[];
  /** String class names written by hand in JSX `class` attributes. */
  classLiterals: ClassLiteral[];
  /** How each styled JSX element composes its style blocks, for the target check. */
  compositions: Composition[];
  /** Every distinct character in the file's JSX text, strings, and templates, for `subset: 'used'`. */
  chars: string;
  /** `visio-ignore` directives in the file. Warnings they cover are already dropped. */
  ignores: IgnoreDirective[];
}

export interface ClassLiteral {
  name: string;
  start: number;
  end: number;
}

/**
 * One way a JSX element can be styled: the style blocks its `class` resolves
 * to, in array order, and those of the nearest styled DOM ancestor when the
 * file shows it. Feeds the report's pointer-target measurement.
 */
export interface Composition {
  blocks: string[];
  parent?: string[];
  start: number;
  end: number;
}

/** A `class` attribute and the JSX elements around it, innermost last. */
interface ClassElement {
  expr: AstNode;
  element: AstNode;
  ancestors: AstNode[];
}

/** Solid control flow that renders its children in place, so it is not a DOM parent. */
const TRANSPARENT = new Set([
  "For",
  "Repeat",
  "Show",
  "Switch",
  "Match",
  "Loading",
  "Errored",
  "Reveal",
]);

/** The tag of a JSX element, or null for a fragment. */
function tagOf(element: AstNode): string | null {
  if (element.type !== "JSXElement") {
    return null;
  }

  const name = child(child(element, "openingElement"), "name");

  if (name.type === "JSXIdentifier") {
    return text(name, "name");
  }

  if (name.type === "JSXMemberExpression") {
    let cur = name;

    while (cur.type === "JSXMemberExpression") {
      cur = child(cur, "object");
    }

    return `${optText(cur, "name") ?? ""}.`;
  }

  return null;
}

/** `cond ? s.a : null` (or undefined, '', false): the branch adds nothing. */
function addsNothing(n: AstNode) {
  return (
    (n.type === "Literal" &&
      (n.value === null || n.value === "" || n.value === false)) ||
    (n.type === "Identifier" && n.name === "undefined")
  );
}

/** Whether a tag is a DOM element rather than a component. */
function isIntrinsic(tag: string) {
  return /^[a-z]/v.test(tag) && !tag.includes(".");
}

const HELPERS = new Set<string>([
  "css",
  "cssVars",
  "dp",
  "dph",
  "columns",
  "sizes",
] satisfies HelperName[]);

function isHelper(name: string): name is HelperName {
  return HELPERS.has(name);
}

/** The query `@visio/image-optimizer` claims, and the parameter it reads `sizes` from. */
const RESPONSIVE_QUERY = "responsive";
const SIZES_PARAM = "sizes";

interface ResponsiveImport {
  file: string;
  query: URLSearchParams;
}

/**
 * `./photo.jpg?responsive` split into its path and query, or null for any
 * other import. An `.svg` is one file at every width, so it has no widths to pick.
 */
function responsiveImport(source: string): ResponsiveImport | null {
  const at = source.indexOf("?");

  if (at === -1) {
    return null;
  }

  const file = source.slice(0, at);
  const query = new URLSearchParams(source.slice(at + 1));

  return query.has(RESPONSIVE_QUERY) && !/\.svg$/iv.test(file)
    ? { file, query }
    : null;
}

function responsiveOf(source: AstNode): ResponsiveImport {
  const value = text(source, "value");
  const target = responsiveImport(value);

  if (!target) {
    throw new Error(
      `[@visio/styling] \`${value}\` was scanned as a ?responsive import but is not one.`
    );
  }

  return target;
}

function keyName(node: AstNode): string {
  return optText(node, "name") ?? String(node.value);
}

/** The expression behind a JSX attribute value, whether braced or a bare string. */
function attributeExpr(value: AstNode): AstNode {
  return value.type === "JSXExpressionContainer"
    ? unwrap(child(value, "expression"))
    : value;
}

/** Flattens `a.b.c` into `['a', 'b', 'c']`, or null if any step is dynamic. */
function memberChain(node: AstNode): [string, ...string[]] | null {
  const parts: string[] = [];
  let cur = unwrap(node);

  while (cur.type === "MemberExpression") {
    const prop = child(cur, "property");

    if (cur.computed) {
      if (prop.type !== "Literal") {
        return null;
      }

      parts.unshift(String(prop.value));
    } else {
      parts.unshift(text(prop, "name"));
    }

    cur = unwrap(child(cur, "object"));
  }

  if (cur.type !== "Identifier") {
    return null;
  }

  return [text(cur, "name"), ...parts];
}

function styleRef(node: AstNode): { name: string; key: string } | null {
  const chain = memberChain(node);

  if (!chain) {
    return null;
  }

  const [name, key, ...more] = chain;

  if (key === undefined || more.length > 0) {
    return null;
  }

  return { name, key };
}

/** An element that renders a `?responsive` import: its `src` and `sizes` attribute values. */
interface ImageUse {
  src: AstNode;
  sizes: AstNode;
}

interface Scan {
  imports: Map<string, { source: string; imported: string }>;
  /** Default-import local name -> the source string node of a `?responsive` import. */
  responsive: Map<string, AstNode>;
  images: ImageUse[];
  helpers: Map<string, HelperName>;
  consts: Map<string, AstNode>;
  calls: AstNode[];
  classArrays: AstNode[];
  classElements: ClassElement[];
  tokenRefs: Set<string>;
  classLiterals: ClassLiteral[];
  chars: Set<string>;
}

function addClassNames(names: string, at: AstNode, out: ClassLiteral[]) {
  for (const name of names.split(/\s+/v)) {
    if (name) {
      out.push({ name, start: at.start, end: at.end });
    }
  }
}

function collectObjectClassLiterals(node: AstNode, out: ClassLiteral[]) {
  for (const prop of children(node, "properties")) {
    if (prop.type !== "Property") {
      continue;
    }

    const key = child(prop, "key");

    if (prop.computed) {
      collectClassLiterals(key, out);
    } else if (key.type === "Identifier") {
      addClassNames(text(key, "name"), key, out);
    } else if (key.type === "Literal" && isString(key.value)) {
      addClassNames(key.value, key, out);
    }
  }
}

/** Every string that can end up in a `class` attribute, split into names. */
function collectClassLiterals(node: AstNode, out: ClassLiteral[]) {
  const n = unwrap(node);

  if (n.type === "Literal" && isString(n.value)) {
    addClassNames(n.value, n, out);
  } else if (n.type === "TemplateLiteral") {
    for (const q of children(n, "quasis")) {
      addClassNames(cookedText(q), q, out);
    }
  } else if (n.type === "ArrayExpression") {
    for (const el of items(n, "elements")) {
      if (el) {
        collectClassLiterals(el, out);
      }
    }
  } else if (n.type === "ObjectExpression") {
    collectObjectClassLiterals(n, out);
  } else if (n.type === "ConditionalExpression") {
    collectClassLiterals(child(n, "consequent"), out);
    collectClassLiterals(child(n, "alternate"), out);
  } else if (n.type === "LogicalExpression") {
    if (n.operator !== "&&") {
      collectClassLiterals(child(n, "left"), out);
    }

    collectClassLiterals(child(n, "right"), out);
  }
}

/** TypeScript nodes that hold an expression; every other `TS*` parent is a type position. */
const TS_EXPRESSIONS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/** Whether an identifier under `parent` at `key` reads the binding of that name. */
function isRead(parent: AstNode, key: string): boolean {
  if (parent.type.startsWith("Import")) {
    return false;
  }

  if (parent.type.startsWith("TS") && !TS_EXPRESSIONS.has(parent.type)) {
    return false;
  }

  if (key === "property" && parent.type === "MemberExpression") {
    return Boolean(parent.computed);
  }

  if (key === "key") {
    return Boolean(parent.computed);
  }

  return key !== "id" && key !== "label";
}

/** The keys a destructuring pattern takes from an object, or null when it takes everything. */
function patternKeys(pattern: AstNode): string[] | null {
  const keys: string[] = [];

  for (const prop of children(pattern, "properties")) {
    if (prop.type !== "Property" || prop.computed) {
      return null;
    }

    keys.push(keyName(child(prop, "key")));
  }

  return keys;
}

/** Adds the names a binding pattern declares to `out`. */
function bindingNames(node: AstNode | null, out: string[]): string[] {
  if (!node) {
    return out;
  }

  if (node.type === "Identifier") {
    out.push(text(node, "name"));
  } else if (node.type === "ObjectPattern") {
    for (const p of children(node, "properties")) {
      bindingNames(p.type === "RestElement" ? p : child(p, "value"), out);
    }
  } else if (node.type === "ArrayPattern") {
    for (const e of items(node, "elements")) {
      bindingNames(e, out);
    }
  } else if (node.type === "AssignmentPattern") {
    bindingNames(child(node, "left"), out);
  } else if (node.type === "RestElement") {
    bindingNames(child(node, "argument"), out);
  } else if (node.type === "TSParameterProperty") {
    bindingNames(child(node, "parameter"), out);
  }

  return out;
}

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** Adds the `var` names under `node` to `out`; they belong to the nearest function. */
function varNames(node: AstNode | null, out: string[]) {
  if (!node || FUNCTIONS.has(node.type)) {
    return;
  }

  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of children(node, "declarations")) {
      bindingNames(child(d, "id"), out);
    }
  }

  for (const c of childNodes(node)) {
    varNames(c.node, out);
  }
}

/** Adds the block-scoped names a statement list declares to `out`. */
function lexicalNames(statements: AstNode[], out: string[]) {
  for (const s of statements) {
    if (s.type === "VariableDeclaration" && s.kind !== "var") {
      for (const d of children(s, "declarations")) {
        bindingNames(child(d, "id"), out);
      }
    } else if (
      s.type === "FunctionDeclaration" ||
      s.type === "ClassDeclaration" ||
      s.type === "TSEnumDeclaration"
    ) {
      bindingNames(optChild(s, "id"), out);
    }
  }
}

function isLoop(node: AstNode) {
  return (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  );
}

/** The names a node declares for the code inside it, which hide an import of the same name. */
function scopeNames(node: AstNode): string[] {
  const out: string[] = [];

  if (FUNCTIONS.has(node.type)) {
    if (node.type === "FunctionExpression") {
      bindingNames(optChild(node, "id"), out);
    }

    for (const p of children(node, "params")) {
      bindingNames(p, out);
    }

    varNames(optChild(node, "body"), out);
  } else if (node.type === "BlockStatement" || node.type === "StaticBlock") {
    lexicalNames(children(node, "body"), out);
  } else if (node.type === "SwitchStatement") {
    for (const c of children(node, "cases")) {
      lexicalNames(children(c, "consequent"), out);
    }
  } else if (isLoop(node)) {
    const decl = optChild(node, node.type === "ForStatement" ? "init" : "left");

    if (decl?.type === "VariableDeclaration" && decl.kind !== "var") {
      lexicalNames([decl], out);
    }
  } else if (node.type === "CatchClause") {
    bindingNames(optChild(node, "param"), out);
  } else if (node.type === "ClassExpression") {
    bindingNames(optChild(node, "id"), out);
  }

  return out;
}

function importedName(spec: AstNode): string {
  if (spec.type === "ImportDefaultSpecifier") {
    return "default";
  }

  if (spec.type === "ImportNamespaceSpecifier") {
    return "*";
  }

  return keyName(child(spec, "imported"));
}

function scanImport(stmt: AstNode, scan: Scan) {
  const sourceNode = child(stmt, "source");
  const source = text(sourceNode, "value");

  for (const spec of children(stmt, "specifiers")) {
    const local = text(child(spec, "local"), "name");
    const imported = importedName(spec);
    scan.imports.set(local, { source, imported });

    if (source === PACKAGE && isHelper(imported)) {
      scan.helpers.set(local, imported);
    }

    if (imported === "default" && responsiveImport(source)) {
      scan.responsive.set(local, sourceNode);
    }
  }
}

function scanConsts(stmt: AstNode, scan: Scan) {
  const decl =
    stmt.type === "ExportNamedDeclaration"
      ? optChild(stmt, "declaration")
      : stmt;

  if (decl?.type !== "VariableDeclaration" || decl.kind !== "const") {
    return;
  }

  for (const d of children(decl, "declarations")) {
    const id = child(d, "id");
    const init = optChild(d, "init");

    if (id.type === "Identifier" && init) {
      scan.consts.set(text(id, "name"), init);
    }
  }
}

function collectChars(node: AstNode, chars: Set<string>) {
  let shown: Iterable<string> = "";

  if (node.type === "JSXText") {
    // The browser or Solid's compiler decodes these, so `&eacute;` counts as é.
    shown = decode(text(node, "value"), { level: "html5" });
  } else if (node.type === "Literal" && isString(node.value)) {
    shown = node.value;
  } else if (node.type === "TemplateElement") {
    shown = cooked(node) ?? "";
  } else if (node.type === "JSXAttribute") {
    // Attribute text (placeholder, alt, title) renders with its entities decoded.
    const value = optChild(node, "value");

    if (value?.type === "Literal" && isString(value.value)) {
      shown = decode(value.value, { level: "html5" });
    }
  }

  for (const ch of shown) {
    chars.add(ch);
  }
}

function collectImage(node: AstNode, images: ImageUse[]) {
  if (node.type !== "JSXOpeningElement") {
    return;
  }

  let src: AstNode | undefined;
  let sizes: AstNode | undefined;

  for (const attr of children(node, "attributes")) {
    const value = attr.type === "JSXAttribute" ? optChild(attr, "value") : null;

    if (!value) {
      continue;
    }

    const name = optText(child(attr, "name"), "name");

    if (name === "src") {
      src = value;
    } else if (name === "sizes") {
      sizes = value;
    }
  }

  if (src && sizes) {
    images.push({ src, sizes });
  }
}

function collectClassAttribute(node: AstNode, scan: Scan, jsxStack: AstNode[]) {
  if (
    node.type !== "JSXAttribute" ||
    optText(child(node, "name"), "name") !== "class"
  ) {
    return;
  }

  const value = optChild(node, "value");

  if (!value) {
    return;
  }

  if (value.type !== "JSXExpressionContainer") {
    collectClassLiterals(value, scan.classLiterals);

    return;
  }

  const expr = unwrap(child(value, "expression"));

  if (expr.type === "ArrayExpression" || expr.type === "ObjectExpression") {
    scan.classArrays.push(expr);
  }

  collectClassLiterals(expr, scan.classLiterals);
  const element = jsxStack.at(-1);

  if (element) {
    scan.classElements.push({
      expr,
      element,
      ancestors: jsxStack.slice(0, -1),
    });
  }
}

function scanProgram(
  program: AstNode,
  isTokensImport: (source: string) => boolean,
  isTokensObject: (imported: string) => boolean
): Scan {
  const scan: Scan = {
    imports: new Map(),
    responsive: new Map(),
    images: [],
    helpers: new Map(),
    consts: new Map(),
    calls: [],
    classArrays: [],
    classElements: [],
    tokenRefs: new Set(),
    classLiterals: [],
    chars: new Set(),
  };

  for (const stmt of children(program, "body")) {
    if (stmt.type === "ImportDeclaration") {
      scanImport(stmt, scan);
    } else {
      scanConsts(stmt, scan);
    }
  }

  const tokenRoots = new Set<string>();

  for (const [local, imp] of scan.imports) {
    if (isTokensImport(imp.source)) {
      tokenRoots.add(local);
    }
  }

  function importOf(local: string) {
    const imp = scan.imports.get(local);

    if (!imp) {
      throw new Error(
        `[@visio/styling] Token root \`${local}\` has no import.`
      );
    }

    return imp;
  }

  // A read without a member path keeps every token: '' is the whole tree.
  function readWhole(local: string, parent: AstNode, key: string) {
    const imp = importOf(local);

    if (imp.imported !== "*" && !isTokensObject(imp.imported)) {
      return;
    }

    if (parent.type === "VariableDeclarator" && key === "init") {
      const id = child(parent, "id");

      const keys =
        id.type === "ObjectPattern" && imp.imported !== "*"
          ? patternKeys(id)
          : null;

      if (keys) {
        for (const k of keys) {
          scan.tokenRefs.add(k);
        }

        return;
      }
    }

    scan.tokenRefs.add("");
  }

  // Token roots that a parameter or local of the same name hides in the scope being walked.
  let hidden = new Set<string>();

  function isRoot(name: string) {
    return tokenRoots.has(name) && !hidden.has(name);
  }

  function readMember(node: AstNode): boolean {
    const chain = memberChain(node);

    if (!chain || !isRoot(chain[0])) {
      return false;
    }

    const [root, ...rest] = chain;
    const path = importOf(root).imported === "*" ? rest.slice(1) : rest;
    scan.tokenRefs.add(path.join("."));

    return true;
  }

  const jsxStack: AstNode[] = [];

  function walk(node: AstNode, parent: AstNode | null, key: string) {
    const outer = hidden;

    if (tokenRoots.size) {
      const shadows = scopeNames(node).filter((name) => tokenRoots.has(name));

      if (shadows.length) {
        hidden = new Set([...hidden, ...shadows]);
      }
    }

    if (node.type === "Identifier" && parent && isRead(parent, key)) {
      const name = text(node, "name");

      if (isRoot(name)) {
        readWhole(name, parent, key);
      }
    }

    if (node.type === "CallExpression") {
      scan.calls.push(node);
    }

    collectChars(node, scan.chars);

    if (node.type === "MemberExpression" && readMember(node)) {
      walk(child(node, "property"), node, "property");

      return;
    }

    collectImage(node, scan.images);
    collectClassAttribute(node, scan, jsxStack);
    const isJsx = node.type === "JSXElement" || node.type === "JSXFragment";

    if (isJsx) {
      jsxStack.push(node);
    }

    for (const c of childNodes(node)) {
      walk(c.node, node, c.key);
    }

    if (isJsx) {
      jsxStack.pop();
    }

    hidden = outer;
  }

  walk(program, null, "");
  scan.calls.sort((a, b) => a.start - b.start);

  return scan;
}

export function extract(opts: ExtractOptions): ExtractResult {
  const { file, code, registry } = opts;

  const empty: ExtractResult = {
    code,
    map: null,
    changed: false,
    diagnostics: [],
    declarations: [],
    globals: [],
    keyframes: [],
    properties: [],
    tokenRefs: [],
    classLiterals: [],
    compositions: [],
    chars: "",
    ignores: [],
  };

  const parsed = parseSync(file, code);

  // Leave syntax errors to the framework compiler, which reports them better.
  if (parsed.errors.length) {
    return empty;
  }

  const { program } = parsed;

  if (!isProgram(program)) {
    throw new Error("[@visio/styling] oxc-parser returned no program node.");
  }

  const scan = scanProgram(program, opts.isTokensImport, (imported) => {
    const value = opts.tokenExports?.[imported];

    return !opts.tokenExports || isTokens(value);
  });

  const { comments } = parsed;
  registry.release(file);

  if (scan.helpers.size === 0 && scan.responsive.size === 0) {
    // No styles, but a hand-typed atom in a class attribute can still be ignored here.
    const ignored = collectDirectives(file, code, comments, []);

    return {
      ...empty,
      diagnostics: ignored.diagnostics,
      tokenRefs: [...scan.tokenRefs],
      classLiterals: scan.classLiterals,
      chars: [...scan.chars].join(""),
      ignores: ignored.directives,
    };
  }

  const diagnostics: Diagnostic[] = [];
  const declarations: Declaration[] = [];
  const globals: GlobalRule[] = [];
  const keyframes = new Map<string, Keyframes>();
  const properties = new Map<string, PropertyRegistration>();
  const conditionNames = new Set(Object.keys(opts.conditions));
  const s = new MagicString(code);
  let changed = false;
  let needsRuntime = false;
  let recipeCount = 0;
  const rewritten: [number, number][] = [];
  /** const name -> style key -> property layer, for the overlap check. */
  const styleLayers = new Map<string, Map<string, Layer>>();

  const locations = new Map<string, SourceSpan>();

  const ctx: EvalContext = {
    file,
    tokenExports: opts.tokenExports,
    consts: scan.consts,
    imports: scan.imports,
    isTokensImport: opts.isTokensImport,
    helpers: scan.helpers,
    locations,
    onKeyframes(frames, node) {
      const name = `kf-${hash(JSON.stringify(frames), 6)}`;

      if (keyframes.has(name)) {
        return name;
      }

      const prefix = constNameFor(node) ?? "keyframes";
      const out: Keyframes = { name, frames: {} };
      const layoutProps = new Map<string, string>();

      for (const [at, style] of Object.entries(frames)) {
        const frame = `${prefix}.${at}`;

        const res = normalize(
          style,
          { conditions: conditionNames, typography: "open", file },
          frame
        );

        diagnostics.push(...res.diagnostics);
        const nested = new Set<string>();

        for (const d of res.declarations) {
          if (
            LAYOUT_PROPS.has(d.prop) &&
            !d.unsafe &&
            !layoutProps.has(d.prop)
          ) {
            layoutProps.set(d.prop, d.path);
          }

          if (d.conds.length || d.selector) {
            // Selector keys may hold dots, so match the frame's own keys.
            const key = Object.keys(style).find((k) =>
              d.path.startsWith(`${frame}.${k}.`)
            );

            nested.add(`${frame}.${key}`);
          }
        }

        for (const path of nested) {
          diagnostics.push(
            errorAt(
              "KEYFRAME_NOT_FLAT",
              `A keyframe holds properties only, so \`${path.slice(frame.length + 1)}\` cannot apply inside it. Set animationName under that condition or selector instead.`,
              { file, path }
            )
          );
        }

        out.frames[at] = res.declarations.map((d) => ({
          prop: d.prop,
          value: d.value,
        }));
      }

      for (const [prop, at] of layoutProps) {
        diagnostics.push(
          errorAt(
            "KEYFRAMES_ANIMATE_LAYOUT",
            `Keyframes animate \`${prop}\`, which forces layout every frame. Animate transform, opacity, or a registered cssVars() property instead.`,
            { file, path: at }
          )
        );
      }

      keyframes.set(name, out);

      return name;
    },
    onCssVars(spec: Record<string, CssVarSpec>) {
      for (const [key, v] of Object.entries(spec)) {
        const name = `--${kebab(key)}`;
        properties.set(name, {
          name,
          syntax: v.syntax,
          initial: String(v.initial),
          inherits: v.inherits ?? false,
        });
      }
    },
  };

  function compileStyle(style: StyleObject, path: string): CompiledStyle {
    const res = normalize(
      style,
      {
        conditions: conditionNames,
        typography: opts.typography,
        fontFloor: opts.fontFloor,
        file,
        locations,
      },
      path
    );

    diagnostics.push(...res.diagnostics);
    const layer: Layer = {};

    if (hasErrors(res.diagnostics)) {
      return { classes: [], layer };
    }

    // A later declaration of the same property identity replaces the earlier one.
    const last = new Map<string, Declaration>();

    for (const d of res.declarations) {
      last.set(propKey(d), d);
    }

    for (const [key, d] of last) {
      declarations.push(d);
      layer[key] = registry.add(file, d).className;
    }

    return { classes: Object.values(layer), layer };
  }

  function overlaps(node: AstNode): boolean {
    return rewritten.some(([a, b]) => node.start >= a && node.end <= b);
  }

  function rewrite(node: AstNode, replacement: string) {
    s.overwrite(node.start, node.end, replacement);
    rewritten.push([node.start, node.end]);
    changed = true;
  }

  function constNameFor(node: AstNode): string | null {
    for (const [name, init] of scan.consts) {
      if (init.start === node.start && init.end === node.end) {
        return name;
      }
    }

    return null;
  }

  type CallKind =
    | "css"
    | "recipe"
    | "global"
    | "keyframes"
    | "cssVars"
    | "sizes";

  function callKind(node: AstNode): CallKind | null {
    const callee = child(node, "callee");

    if (callee.type === "Identifier") {
      const h = scan.helpers.get(text(callee, "name"));

      if (h === "css" || h === "cssVars" || h === "sizes") {
        return h;
      }

      return null;
    }

    if (callee.type === "MemberExpression" && !callee.computed) {
      const obj = child(callee, "object");
      const prop = optText(child(callee, "property"), "name");

      if (
        obj.type === "Identifier" &&
        scan.helpers.get(text(obj, "name")) === "css" &&
        (prop === "recipe" || prop === "global" || prop === "keyframes")
      ) {
        return prop;
      }
    }

    return null;
  }

  /** A computed style key, evaluated like a value. */
  function styleKey(key: AstNode): string {
    const value = evaluateValue(key, ctx, "");

    if (isString(value) || isNumber(value)) {
      return String(value);
    }

    throw new EvalError(
      errorAt(
        "STYLE_KEY_NOT_STATIC",
        `A computed style key must be a string known at build time.`,
        {
          file,
          start: key.start,
          end: key.end,
        }
      )
    );
  }

  function handleCss(node: AstNode, arg: AstNode) {
    if (arg.type !== "ObjectExpression") {
      throw new EvalError(
        errorAt(
          "STYLE_NEEDS_OBJECT",
          `css() needs an inline object literal so every style is visible where it is used.`,
          { file, start: arg.start, end: arg.end }
        )
      );
    }

    const entries: string[] = [];
    const layers = new Map<string, Layer>();

    for (const prop of children(arg, "properties")) {
      if (prop.type === "SpreadElement") {
        throw new EvalError(
          errorAt(
            "SPREAD_OUTSIDE_STYLE",
            `Spread inside css() at the top level is not supported. Spread inside each style instead.`,
            { file, start: prop.start, end: prop.end }
          )
        );
      }

      const name = prop.computed
        ? styleKey(child(prop, "key"))
        : keyName(child(prop, "key"));

      // The style key itself, so a directive above it covers the whole block.
      locations.set(name, { start: prop.start, end: prop.end });
      const style = evaluateStyle(child(prop, "value"), ctx, name);
      const { classes, layer } = compileStyle(style, name);
      layers.set(name, layer);
      entries.push(
        `${JSON.stringify(name)}: ${JSON.stringify(classes.join(" "))}`
      );
    }

    const constName = constNameFor(node);

    if (constName) {
      styleLayers.set(constName, layers);
    }

    rewrite(node, `{ ${entries.join(", ")} }`);
  }

  /** Checks a recipe definition's keys and shapes, so a typo fails instead of vanishing. */
  function recipeDefinition(arg: AstNode, prefix: string): RecipeDef {
    const def = evaluateValue(arg, ctx, prefix);

    function wrong(what: string): never {
      throw new EvalError(
        errorAt("RECIPE_MALFORMED", `${what}.`, {
          file,
          start: arg.start,
          end: arg.end,
          path: prefix,
        })
      );
    }

    if (!isObject(def)) {
      return wrong("css.recipe() needs an object literal");
    }

    for (const key of Object.keys(def)) {
      if (!RECIPE_KEYS.includes(key)) {
        wrong(
          `\`${key}\` is not part of a recipe. Use ${RECIPE_KEYS.join(", ")}`
        );
      }
    }

    if (def.base !== undefined && !isObject(def.base)) {
      wrong("`base` is a style object");
    }

    const variants = def.variants ?? {};

    if (!isObject(variants)) {
      return wrong("`variants` maps each variant to its options");
    }

    const known = variants;

    for (const [name, options] of Object.entries(variants)) {
      if (!isObject(options) || !Object.values(options).every(isObject)) {
        wrong(
          `\`variants.${name}\` maps each option to a style object: { ${name}: { a: { ... } } }`
        );
      }
    }

    // A boolean picks the `true` or `false` option; a string names one.
    function checkChoice(
      where: string,
      owner: Record<string, unknown>,
      key: string
    ) {
      const choice = owner[key];

      if (!isObject(choice)) {
        return wrong(`\`${where}\` maps variant names to options`);
      }

      for (const [name, value] of Object.entries(choice)) {
        const options = known[name];

        if (!isObject(options)) {
          wrong(`\`${where}.${name}\` names no variant`);
        } else if (isBoolean(value)) {
          if (
            !Object.hasOwn(options, "true") &&
            !Object.hasOwn(options, "false")
          ) {
            wrong(
              `\`${where}.${name}\` is ${value}, but \`${name}\` has no true or false option`
            );
          }
        } else if (!Object.hasOwn(options, String(value))) {
          wrong(
            `\`${where}.${name}\` is ${JSON.stringify(value)}, which is not an option`
          );
        }
      }
    }

    const compound = def.compound ?? [];

    if (!Array.isArray(compound)) {
      return wrong("`compound` is a list of { when, style }");
    }

    for (const [i, c] of compound.entries()) {
      if (!isObject(c) || !isObject(c.style)) {
        wrong(`\`compound[${i}]\` is { when, style }`);
      }

      checkChoice(`compound[${i}].when`, c, "when");
    }

    if (def.defaults !== undefined) {
      checkChoice("defaults", def, "defaults");
    }

    // SAFETY: every key and shape of RecipeDef was checked above.
    return def as RecipeDef;
  }

  function handleRecipe(node: AstNode, arg: AstNode) {
    const compiled: CompiledRecipe = {
      base: {},
      variants: {},
      compound: [],
      defaults: {},
    };

    // Diagnostics name the recipe by its const so two recipes in one file stay apart.
    let prefix = constNameFor(node);

    if (prefix === null) {
      recipeCount += 1;
      prefix = `recipe${recipeCount}`;
    }

    const def = recipeDefinition(arg, prefix);

    if (def.base) {
      compiled.base = compileStyle(def.base, `${prefix}.base`).layer;
    }

    for (const [vName, options] of Object.entries(def.variants ?? {})) {
      const layers: Record<string, Layer> = {};
      compiled.variants[vName] = layers;

      for (const [oName, style] of Object.entries(options)) {
        layers[oName] = compileStyle(
          style,
          `${prefix}.variants.${vName}.${oName}`
        ).layer;
      }
    }

    for (const [i, c] of (def.compound ?? []).entries()) {
      compiled.compound.push({
        when: c.when,
        layer: compileStyle(c.style, `${prefix}.compound.${i}`).layer,
      });
    }

    compiled.defaults = def.defaults ?? {};
    needsRuntime = true;
    rewrite(node, `__visioRecipe(${JSON.stringify(compiled)})`);
  }

  function handleGlobal(node: AstNode, arg: AstNode) {
    // SAFETY: css.global() is typed to take selector -> style object, so the
    // type checker has already checked the argument.
    const rules = evaluateValue(arg, ctx, "global") as Record<
      string,
      StyleObject
    >;

    for (const [selector, style] of Object.entries(rules)) {
      const where = {
        file,
        start: arg.start,
        end: arg.end,
        path: `global.${selector}`,
      };

      if (selector.startsWith("@")) {
        diagnostics.push(
          errorAt(
            "AT_RULE_REJECTED",
            `Raw at-rule \`${selector}\` is not allowed in css.global(). Add it to \`conditions\` in the tokens and nest the name inside a selector: \`body: { print: { ... } }\`.`,
            where
          )
        );
        continue;
      }

      if (mentionsHover(selector)) {
        diagnostics.push(
          errorAt(
            "HOVER_NEEDS_CONDITION",
            `\`${selector}\` applies on touch screens too, where a tap leaves it stuck. Nest the \`hover\` condition inside the selector without \`:hover\`: \`a: { hover: { ... } }\`.`,
            where
          )
        );
        continue;
      }

      const res = normalize(
        style,
        {
          conditions: conditionNames,
          typography: opts.typography,
          fontFloor: opts.fontFloor,
          file,
          locations,
        },
        `global.${selector}`
      );

      diagnostics.push(...res.diagnostics);
      const groups = new Map<string, GlobalRule>();

      for (const d of res.declarations) {
        declarations.push(d);
        const k = `${d.selector}|${d.conds.join("+")}`;
        let g = groups.get(k);

        if (!g) {
          g = {
            selector,
            template: d.selector,
            declarations: [],
            conds: d.conds,
            origin: d.loc ? { file, offset: d.loc.start } : undefined,
          };
          groups.set(k, g);
        }

        g.declarations.push({ prop: d.prop, value: d.value });
      }

      globals.push(...groups.values());
    }

    rewrite(node, "undefined");
  }

  function handleCall(node: AstNode) {
    const kind = callKind(node);

    if (!kind || overlaps(node)) {
      return;
    }

    const [arg] = children(node, "arguments");

    if (!arg) {
      const name =
        kind === "css" || kind === "cssVars" || kind === "sizes"
          ? kind
          : `css.${kind}`;

      diagnostics.push(
        errorAt(
          "ARGUMENT_MISSING",
          `${name}() needs ${kind === "sizes" ? "a width" : "an object literal"}.`,
          { file, start: node.start, end: node.end }
        )
      );

      return;
    }

    try {
      if (kind === "css") {
        handleCss(node, arg);
      } else if (kind === "recipe") {
        handleRecipe(node, arg);
      } else if (kind === "global") {
        handleGlobal(node, arg);
      } else if (kind === "keyframes" || kind === "sizes") {
        rewrite(node, JSON.stringify(evaluateValue(node, ctx, kind)));
      } else {
        evaluateValue(node, ctx, "cssVars");
      }
    } catch (error) {
      if (!(error instanceof EvalError)) {
        throw error;
      }

      diagnostics.push(error.diagnostic);
    }
  }

  interface Ref {
    label: string;
    layer: Layer;
  }

  function refsOf(node: AstNode): Ref[][] {
    const n = unwrap(node);

    if (n.type === "MemberExpression") {
      const ref = styleRef(n);
      const layer = ref && styleLayers.get(ref.name)?.get(ref.key);

      if (ref && layer) {
        return [[{ label: `${ref.name}.${ref.key}`, layer }]];
      }

      return [[]];
    }

    if (n.type === "LogicalExpression") {
      if (n.operator === "&&") {
        return refsOf(child(n, "right"));
      }

      return [...refsOf(child(n, "left")), ...refsOf(child(n, "right"))];
    }

    if (n.type === "ConditionalExpression") {
      return [
        ...refsOf(child(n, "consequent")),
        ...refsOf(child(n, "alternate")),
      ];
    }

    return [[]];
  }

  /**
   * Overlap check for `class={[s.a, cond && s.b]}` and `class={{ [s.a]: x }}`:
   * any two entries that can be present together and set the same property
   * identity get a warning.
   */
  function checkClassArray(array: AstNode) {
    // Each entry is a list of alternatives (branches of a ternary); each alternative a list of refs.
    const entries: Ref[][][] = [];

    // Solid's object form, `{ [s.b]: cond }`: each key can be present.
    function pushKeys(object: AstNode) {
      for (const prop of children(object, "properties")) {
        if (prop.type === "Property" && prop.computed) {
          entries.push(refsOf(child(prop, "key")));
        }
      }
    }

    if (array.type === "ObjectExpression") {
      pushKeys(array);
    }

    for (const el of array.type === "ArrayExpression"
      ? items(array, "elements")
      : []) {
      if (!el) {
        continue;
      }

      if (el.type === "ArrayExpression") {
        for (const inner of items(el, "elements")) {
          if (inner) {
            entries.push(refsOf(inner));
          }
        }

        continue;
      }

      if (el.type === "ObjectExpression") {
        pushKeys(el);

        continue;
      }

      entries.push(refsOf(el));
    }

    const reported = new Set<string>();

    for (const [i, altsA] of entries.entries()) {
      for (const altsB of entries.slice(i + 1)) {
        for (const altA of altsA) {
          for (const altB of altsB) {
            for (const a of altA) {
              for (const b of altB) {
                // By property alone: `desktop: { color }` in one style still beats a
                // plain `color` in the other, because conditions come later in
                // the stylesheet.
                const props = new Set(Object.keys(b.layer).map(propOf));

                for (const key of Object.keys(a.layer)) {
                  const prop = propOf(key);

                  if (!props.has(prop) || a.layer[key] === b.layer[key]) {
                    continue;
                  }

                  const id = `${a.label}|${b.label}|${prop}`;

                  if (reported.has(id)) {
                    continue;
                  }

                  reported.add(id);
                  diagnostics.push(
                    warning(
                      "CLASSES_OVERLAP",
                      `\`${a.label}\` and \`${b.label}\` both set \`${prop}\`; which one wins depends on the stylesheet, not on this order. Merge them into one style, or make the difference a css.recipe() variant.`,
                      { file, start: array.start, end: array.end }
                    )
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * The style blocks a `class` expression can resolve to, one list per way
   * the expression can evaluate, in array order. Null when any part is not
   * a style block from this file (a prop, a hand-typed name, a recipe call),
   * because then the element's box is not known from here.
   */
  function blockAlternatives(node: AstNode): string[][] | null {
    const n = unwrap(node);

    if (addsNothing(n)) {
      return [[]];
    }

    if (n.type === "MemberExpression") {
      const ref = styleRef(n);

      if (ref && styleLayers.get(ref.name)?.has(ref.key)) {
        return [[ref.key]];
      }

      return null;
    }

    if (n.type === "LogicalExpression") {
      const right = blockAlternatives(child(n, "right"));

      if (n.operator === "&&") {
        return right && [[], ...right];
      }

      const left = blockAlternatives(child(n, "left"));

      return left && right && [...left, ...right];
    }

    if (n.type === "ConditionalExpression") {
      const a = blockAlternatives(child(n, "consequent"));
      const b = blockAlternatives(child(n, "alternate"));

      return a && b && [...a, ...b];
    }

    if (n.type === "ArrayExpression" || n.type === "ObjectExpression") {
      return listAlternatives(n);
    }

    return null;
  }

  function listAlternatives(n: AstNode): string[][] | null {
    const parts =
      n.type === "ArrayExpression"
        ? items(n, "elements").filter((el) => el !== null)
        : children(n, "properties").map((prop) =>
            prop.type === "Property" && prop.computed
              ? child(prop, "key")
              : null
          );

    let out: string[][] = [[]];

    for (const part of parts) {
      const alts = part ? blockAlternatives(part) : null;

      if (!alts) {
        return null;
      }

      // An object entry is present or not, like `cond && s.x`.
      const options = n.type === "ObjectExpression" ? [[], ...alts] : alts;
      out = out.flatMap((prefix) => options.map((alt) => [...prefix, ...alt]));

      if (out.length > 64) {
        return null;
      }
    }

    return out;
  }

  /** Every element's style compositions, with the nearest styled DOM ancestor's when it is known. */
  function collectCompositions(): Composition[] {
    const own = new Map<AstNode, string[][] | null>();

    for (const c of scan.classElements) {
      own.set(c.element, blockAlternatives(c.expr));
    }

    const out: Composition[] = [];

    for (const c of scan.classElements) {
      const alts = own.get(c.element);

      if (!alts) {
        continue;
      }

      let parents: string[][] | null | undefined;

      for (const ancestor of c.ancestors.toReversed()) {
        const tag = tagOf(ancestor);

        if (tag === null || TRANSPARENT.has(tag)) {
          continue;
        }

        // A component may wrap its children in anything; an unstyled DOM
        // parent has a box this file says nothing about.
        parents =
          isIntrinsic(tag) && own.has(ancestor) ? own.get(ancestor) : null;
        break;
      }

      for (const blocks of alts) {
        if (blocks.length === 0) {
          continue;
        }

        for (const parent of parents ?? [undefined]) {
          const { start, end } = c.expr;
          out.push(
            parent?.length
              ? { blocks, parent, start, end }
              : { blocks, start, end }
          );
        }
      }
    }

    return out;
  }

  function rewriteImageImports() {
    const bySource = new Map<AstNode, Set<string>>();

    for (const use of scan.images) {
      const src = attributeExpr(use.src);

      if (src.type !== "Identifier") {
        continue;
      }

      const source = scan.responsive.get(text(src, "name"));

      if (!source) {
        continue;
      }

      let value: unknown;

      try {
        value = evaluateValue(attributeExpr(use.sizes), ctx, SIZES_PARAM);
      } catch (error) {
        if (error instanceof EvalError) {
          continue;
        }

        throw error;
      }

      if (!isString(value) || !value) {
        continue;
      }

      let set = bySource.get(source);

      if (!set) {
        bySource.set(source, (set = new Set()));
      }

      set.add(value);
    }

    for (const [source, values] of bySource) {
      const target = responsiveOf(source);

      for (const v of values) {
        target.query.append(SIZES_PARAM, v);
      }

      rewrite(
        source,
        JSON.stringify(`${target.file}?${target.query.toString()}`)
      );
    }

    for (const [local, source] of scan.responsive) {
      // A `sizes` written into the query by hand is a value too.
      if (bySource.has(source) || responsiveOf(source).query.has(SIZES_PARAM)) {
        continue;
      }

      diagnostics.push(
        warning(
          "RESPONSIVE_NEEDS_SIZES",
          `\`${local}\` never reaches an element with a static \`sizes\` in this file, so the image optimizer encodes every width. Render it here: \`<Image src={${local}} sizes={sizes(...)} />\`. If every width should ship, write \`// visio-ignore RESPONSIVE_NEEDS_SIZES: why\` above the import.`,
          { file, start: source.start, end: source.end }
        )
      );
    }
  }

  for (const call of scan.calls) {
    handleCall(call);
  }

  rewriteImageImports();

  for (const array of scan.classArrays) {
    checkClassArray(array);
  }

  const compositions = collectCompositions();

  if (needsRuntime) {
    s.prepend(RUNTIME_IMPORT);
  }

  // Directives need the key spans the evaluator recorded, so they come last;
  // the warnings they cover leave the file's diagnostics here.
  const ignored = collectDirectives(file, code, comments, locations);
  diagnostics.push(...ignored.diagnostics);

  const kept = applyIgnores(
    diagnostics,
    ignored.directives,
    lineStartsOf(code)
  );

  return {
    code: changed ? s.toString() : code,
    map: changed
      ? s.generateMap({
          hires: true,
          source: opts.sourcePath ?? file,
          includeContent: false,
        })
      : null,
    changed,
    diagnostics: kept,
    declarations,
    globals,
    keyframes: [...keyframes.values()],
    properties: [...properties.values()],
    tokenRefs: [...scan.tokenRefs],
    classLiterals: scan.classLiterals,
    compositions,
    chars: [...scan.chars].join(""),
    ignores: ignored.directives,
  };
}
