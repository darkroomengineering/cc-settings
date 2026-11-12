import { hasRef, isNumber, isString } from "../guards.ts";
import type { CssVarSpec } from "../helpers.ts";
import { columns, cssVars, dph, dp } from "../helpers.ts";
import { GRID, HIT_AREA, SR_ONLY } from "../presets.ts";
import { SizesHeightError, sizesFor } from "../sizes.ts";
import type { DesignWidth } from "../sizes.ts";
import type { ColorLeaf, Tokens, TypeLeaf } from "../tokens/index.ts";
import {
  onScreen,
  resolveResponsive,
  screenStops,
  TOKENS_MARK,
} from "../tokens/index.ts";
import type { Responsive } from "../tokens/types.ts";
import { child, children, cookedText, optText, text } from "./ast.ts";
import type { AstNode } from "./ast.ts";
import { error as errorAt } from "./errors.ts";
import type { Diagnostic } from "./errors.ts";
import { FluidValue, PresetValue } from "./model.ts";
import type { SourceSpan, StyleObject, StyleValue } from "./model.ts";

export type HelperName = "css" | "cssVars" | "dp" | "dph" | "columns" | "sizes";

export interface EvalContext {
  file: string;
  /** Exports of the project's tokens module, when loaded. */
  tokenExports: Record<string, unknown> | null;
  consts: Map<string, AstNode>;
  imports: Map<string, { source: string; imported: string }>;
  isTokensImport: (source: string) => boolean;
  /** Local binding name -> helper it refers to. */
  helpers: Map<string, HelperName>;
  onKeyframes: (frames: Record<string, StyleObject>, node: AstNode) => string;
  onCssVars: (spec: Record<string, CssVarSpec>) => void;
  /** Filled with the source span of every object key, by dotted path. */
  locations?: Map<string, SourceSpan>;
}

export class EvalError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "EvalError";
    this.diagnostic = diagnostic;
  }
}

function fail(
  code: string,
  message: string,
  ctx: EvalContext,
  node: AstNode,
  path: string
): never {
  throw new EvalError(
    errorAt(code, message, {
      file: ctx.file,
      start: node.start,
      end: node.end,
      path,
    })
  );
}

function isTypeLeaf<T>(v: T): v is T & TypeLeaf {
  return (
    typeof v === "object" && v !== null && "kind" in v && v.kind === "preset"
  );
}

function isObjectLike(v: unknown): v is object {
  return (typeof v === "object" && v !== null) || typeof v === "function";
}

function isFunction(v: unknown): v is (...args: never[]) => void {
  return typeof v === "function";
}

function isPlain<T>(v: T): v is T & Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !hasRef(v) &&
    !isTypeLeaf(v) &&
    !(v instanceof FluidValue)
  );
}

/** A nested style block: a condition or selector object, not a leaf value. */
function isBlock(v: StyleValue): v is StyleObject {
  return isPlain(v) && !(v instanceof PresetValue);
}

/**
 * Sets `key` on a style. When both the existing value and the new one are
 * nested blocks they merge, so `{ ...t.type.lead, desktop: { maxWidth } }` keeps
 * the preset's desktop metrics next to the author's own `desktop` instead of the
 * later block replacing the earlier one. A leaf written again moves to the
 * end, so it also beats a shorthand written between the two.
 */
function assignStyle(out: StyleObject, key: string, value: StyleValue) {
  const prev = out[key];

  if (isBlock(prev) && isBlock(value)) {
    const merged: StyleObject = { ...prev };

    for (const [k, v] of Object.entries(value)) {
      assignStyle(merged, k, v);
    }

    out[key] = merged;
  } else {
    Reflect.deleteProperty(out, key);
    out[key] = value;
  }
}

/** A `sizes()` argument as the pure helper reads it: fluid values as their css strings. */
function designWidth(v: unknown): Responsive<DesignWidth> {
  if (isPlain(v) && "mobile" in v) {
    // SAFETY: sizesFor() checks every width it reads and throws a message
    // the caller reports as SIZES_NEEDS_WIDTH.
    return Object.fromEntries(
      Object.entries(v).map(([screen, x]) => [screen, oneWidth(x)])
    ) as Responsive<DesignWidth>;
  }

  return oneWidth(v);
}

/** One height as text; sizesFor() rejects what is not a length with SIZES_HEIGHT_UNREADABLE. */
function heightText(x: unknown): string {
  return x instanceof FluidValue ? x.css : String(x);
}

/** A `sizes()` height as the pure helper reads it. */
function designHeight(v: unknown): Responsive<string> {
  if (isPlain(v)) {
    // SAFETY: the keys are screens; resolveResponsive() rejects any other.
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, heightText(x)])
    ) as Responsive<string>;
  }

  return heightText(v);
}

function oneWidth(x: unknown): DesignWidth {
  // SAFETY: sizesFor() checks every width it reads and throws a message the
  // caller reports as SIZES_NEEDS_WIDTH.
  return (x instanceof FluidValue ? x.css : x) as DesignWidth;
}

function fluid(helper: "dp" | "dph" | "columns", n: number): FluidValue {
  if (helper === "dp") {
    return new FluidValue("dp", n, dp(n));
  }

  if (helper === "dph") {
    return new FluidValue("dph", n, dph(n));
  }

  return new FluidValue("col", n, columns(n));
}

/** The expression under TypeScript assertions and parentheses. */
export function unwrap(node: AstNode): AstNode {
  let n = node;

  while (
    n.type === "TSAsExpression" ||
    n.type === "TSSatisfiesExpression" ||
    n.type === "TSNonNullExpression" ||
    n.type === "ParenthesizedExpression" ||
    n.type === "TSTypeAssertion"
  ) {
    n = child(n, "expression");
  }

  return n;
}

/** Expands a type preset into camelCase properties wrapped in PresetValue. */
function expandPreset(
  leaf: TypeLeaf,
  tokens: Tokens,
  ctx: EvalContext,
  node: AstNode,
  path: string
): StyleObject {
  const p = leaf.preset;
  const fontLeaf = tokens.fonts[p.font];

  if (!fontLeaf) {
    fail(
      "FONT_UNKNOWN",
      `Type preset \`${leaf.key}\` uses font \`${p.font}\`, which is not in tokens.fonts.`,
      ctx,
      node,
      path
    );
  }

  const stops = screenStops(tokens.source);
  const size = resolveResponsive(p.size, stops);
  const lh = resolveResponsive(p.lineHeight, stops);
  const ls = resolveResponsive(p.letterSpacing, stops);
  const wt = resolveResponsive(p.weight, stops);

  function wrap(v: string | number) {
    return new PresetValue(v, leaf.key);
  }

  function scaled(n: number) {
    return new PresetValue(dp(n), leaf.key, { kind: "dp", n });
  }

  const base: StyleObject = {
    fontFamily: wrap(fontLeaf.ref),
    fontSize: scaled(onScreen(size, "mobile")),
    lineHeight: wrap(onScreen(lh, "mobile")),
    letterSpacing: wrap(onScreen(ls, "mobile")),
    fontWeight: wrap(onScreen(wt, "mobile")),
  };

  if (p.style) {
    base.fontStyle = wrap(p.style);
  }

  if (p.transform) {
    base.textTransform = wrap(p.transform);
  }

  // One block per screen whose metrics change from the screen before it.
  for (const [i, stop] of stops.entries()) {
    const before = i > 0 ? stops[i - 1] : undefined;

    if (!before) {
      continue;
    }

    const s = stop.name;
    const prev = before.name;
    const block: StyleObject = {};

    if (size[s] !== size[prev]) {
      block.fontSize = scaled(onScreen(size, s));
    }

    if (lh[s] !== lh[prev]) {
      block.lineHeight = wrap(onScreen(lh, s));
    }

    if (ls[s] !== ls[prev]) {
      block.letterSpacing = wrap(onScreen(ls, s));
    }

    if (wt[s] !== wt[prev]) {
      block.fontWeight = wrap(onScreen(wt, s));
    }

    if (Object.keys(block).length) {
      if (stop.condition === undefined) {
        throw new Error(
          `[@visio/styling] Screen \`${s}\` comes after mobile but has no condition.`
        );
      }

      base[stop.condition] = block;
    }
  }

  return base;
}

const evaluating = new Set<AstNode>();

function evaluateTemplate(
  node: AstNode,
  ctx: EvalContext,
  path: string
): string {
  const exprs = children(node, "expressions");
  let out = "";

  for (const [i, q] of children(node, "quasis").entries()) {
    out += cookedText(q);
    const expr = exprs[i];

    if (!expr) {
      continue;
    }

    const v = evaluateValue(expr, ctx, path);

    if (hasRef(v)) {
      out += v.ref;
    } else if (isString(v) || isNumber(v) || v instanceof FluidValue) {
      out += String(v);
    } else {
      fail(
        "TEMPLATE_NOT_STATIC",
        `Only strings, numbers, tokens, and cssVars can be interpolated into a style value.`,
        ctx,
        expr,
        path
      );
    }
  }

  return out;
}

function evaluateUnary(node: AstNode, ctx: EvalContext, path: string): number {
  const v = evaluateValue(child(node, "argument"), ctx, path);
  const op = text(node, "operator");

  if (op === "-" && isNumber(v)) {
    return -v;
  }

  if (op === "+" && isNumber(v)) {
    return v;
  }

  return fail(
    "EXPRESSION_NOT_STATIC",
    `Unsupported unary expression \`${op}\`.`,
    ctx,
    node,
    path
  );
}

function evaluateBinary(
  node: AstNode,
  ctx: EvalContext,
  path: string
): number | string {
  const a = evaluateValue(child(node, "left"), ctx, path);
  const b = evaluateValue(child(node, "right"), ctx, path);
  const op = text(node, "operator");

  if (isNumber(a) && isNumber(b)) {
    if (op === "+") {
      return a + b;
    }

    if (op === "-") {
      return a - b;
    }

    if (op === "*") {
      return a * b;
    }

    if (op === "/") {
      return a / b;
    }
  }

  if (op === "+" && (isString(a) || isString(b))) {
    return (hasRef(a) ? a.ref : String(a)) + (hasRef(b) ? b.ref : String(b));
  }

  return fail(
    "EXPRESSION_NOT_STATIC",
    `Cannot evaluate \`${op}\` on these operands at build time.`,
    ctx,
    node,
    path
  );
}

/** The style objects `@visio/styling` exports, which a block may spread. */
const PRESETS = new Map<string, object>([
  ["GRID", GRID],
  ["HIT_AREA", HIT_AREA],
  ["SR_ONLY", SR_ONLY],
]);

function evaluateTokenImport(
  name: string,
  imported: string,
  ctx: EvalContext,
  node: AstNode,
  path: string
) {
  if (!ctx.tokenExports) {
    return fail(
      "TOKENS_NOT_LOADED",
      `Tokens module could not be loaded, so \`${name}\` cannot be resolved.`,
      ctx,
      node,
      path
    );
  }

  const value = ctx.tokenExports[imported];

  if (value === undefined) {
    fail(
      "TOKEN_EXPORT_UNKNOWN",
      `Tokens module has no export \`${imported}\`.`,
      ctx,
      node,
      path
    );
  }

  return value;
}

function evaluateIdentifier(node: AstNode, ctx: EvalContext, path: string) {
  const name = text(node, "name");

  if (name === "undefined") {
    return;
  }

  const init = ctx.consts.get(name);

  if (init) {
    if (evaluating.has(init)) {
      fail("CONST_CIRCULAR", `\`${name}\` refers to itself.`, ctx, node, path);
    }

    evaluating.add(init);

    try {
      return evaluateValue(init, ctx, path);
    } finally {
      evaluating.delete(init);
    }
  }

  const imp = ctx.imports.get(name);

  if (imp) {
    if (ctx.isTokensImport(imp.source)) {
      return evaluateTokenImport(name, imp.imported, ctx, node, path);
    }

    const preset = PRESETS.get(imp.imported);

    if (imp.source === "@visio/styling" && preset) {
      return preset;
    }

    return fail(
      "IMPORT_NOT_STATIC",
      `\`${name}\` is imported from \`${imp.source}\`, which the compiler cannot read. Only the tokens module and @visio/styling (its helpers, SR_ONLY, HIT_AREA and GRID) can be imported into styles; move shared values into the tokens.`,
      ctx,
      node,
      path
    );
  }

  return fail(
    "VALUE_NOT_STATIC",
    `\`${name}\` is not a top-level const in this file. Styles must be static; for values that change at runtime declare a cssVars() property and set it from the style prop.`,
    ctx,
    node,
    path
  );
}

function evaluateMember(node: AstNode, ctx: EvalContext, path: string) {
  const obj = evaluateValue(child(node, "object"), ctx, path);
  const propNode = child(node, "property");

  const key = node.computed
    ? evaluateValue(propNode, ctx, path)
    : text(propNode, "name");

  if (!isObjectLike(obj)) {
    return fail(
      "MEMBER_NOT_STATIC",
      `Cannot read \`${String(key)}\` at build time.`,
      ctx,
      node,
      path
    );
  }

  // SAFETY: any object can be read by key; the value stays unknown until a
  // caller checks it.
  const value = (obj as Record<string, unknown>)[String(key)];

  if (value === undefined) {
    const known = Object.keys(obj)
      .filter((k) => !k.startsWith("__"))
      .slice(0, 12);

    return fail(
      "TOKEN_UNKNOWN",
      `\`${String(key)}\` does not exist here. Known keys: ${known.join(", ") || "none"}.`,
      ctx,
      node,
      path
    );
  }

  return value;
}

function evaluateSizes(
  args: unknown[],
  ctx: EvalContext,
  node: AstNode,
  path: string
): string {
  const tokens = findTokens(ctx);

  if (!tokens) {
    return fail(
      "TOKENS_NOT_LOADED",
      `sizes() needs the tokens module.`,
      ctx,
      node,
      path
    );
  }

  const [width, options] = args;
  const height = isPlain(options) ? options.height : undefined;

  if (
    args.length === 0 ||
    args.length > 2 ||
    (options !== undefined &&
      (height === undefined || Object.keys(options ?? {}).length !== 1))
  ) {
    fail(
      "SIZES_NEEDS_WIDTH",
      `sizes() takes one width: a design px number, dp(n), columns(n), t.layout.col, or a fixed '320px', once or per screen. A box that the screen height limits also gives its height: sizes(width, { height: \`calc(100svh - \${dp(144)})\` }).`,
      ctx,
      node,
      path
    );
  }

  if (isPlain(height) && !("mobile" in height)) {
    fail(
      "SIZES_HEIGHT_UNREADABLE",
      `sizes(): a height per screen names mobile, as a width does: { height: { mobile: dp(600), desktop: '100svh' } }.`,
      ctx,
      node,
      path
    );
  }

  try {
    return sizesFor(
      tokens.source,
      designWidth(width),
      height === undefined ? undefined : { height: designHeight(height) }
    );
  } catch (error) {
    // The diagnostic adds the package prefix itself.
    return fail(
      error instanceof SizesHeightError
        ? "SIZES_HEIGHT_UNREADABLE"
        : "SIZES_NEEDS_WIDTH",
      (error instanceof Error ? error.message : String(error)).replace(
        /^\[@visio\/styling\] /v,
        ""
      ),
      ctx,
      node,
      path
    );
  }
}

function evaluateHelperCall(
  helper: HelperName | undefined,
  args: unknown[],
  ctx: EvalContext,
  node: AstNode,
  path: string
) {
  if (helper === "dp" || helper === "dph" || helper === "columns") {
    const [n] = args;

    if (!isNumber(n) || Number.isNaN(n)) {
      return fail(
        "HELPER_NEEDS_NUMBER",
        `${helper}() needs a number literal, got ${typeof n}.`,
        ctx,
        node,
        path
      );
    }

    return fluid(helper, n);
  }

  if (helper === "sizes") {
    return evaluateSizes(args, ctx, node, path);
  }

  if (helper === "cssVars") {
    const [spec] = args;

    if (!isPlain(spec)) {
      return fail(
        "CSSVARS_NEEDS_OBJECT",
        `cssVars() needs an object literal.`,
        ctx,
        node,
        path
      );
    }

    // SAFETY: cssVars() is typed to take name -> CssVarSpec, so the type
    // checker has already checked the argument.
    const specs = spec as Record<string, CssVarSpec>;
    ctx.onCssVars(specs);

    return cssVars(specs);
  }

  return null;
}

function isColorLeaf(value: unknown): value is ColorLeaf {
  return (
    hasRef(value) &&
    "alpha" in value &&
    typeof value.alpha === "function" &&
    "name" in value &&
    String(value.name).startsWith("--colors-")
  );
}

/** `t.colors.x.alpha(0.3)`: the colour token at an opacity, from a literal amount. */
function evaluateAlpha(
  callee: AstNode,
  args: unknown[],
  ctx: EvalContext,
  node: AstNode,
  path: string
) {
  const leaf = evaluateValue(unwrap(child(callee, "object")), ctx, path);
  const [amount] = args;

  if (!isColorLeaf(leaf)) {
    return fail(
      "ALPHA_NEEDS_COLOR",
      `.alpha() works on a colour token only, such as t.colors.ink.alpha(0.3).`,
      ctx,
      node,
      path
    );
  }

  if (args.length !== 1 || !isNumber(amount) || amount < 0 || amount > 1) {
    return fail(
      "ALPHA_NEEDS_AMOUNT",
      `.alpha() takes one number from 0 to 1, such as ${leaf.name.replace("--colors-", "t.colors.")}.alpha(0.3).`,
      ctx,
      node,
      path
    );
  }

  return leaf.alpha(amount);
}

function evaluateCall(node: AstNode, ctx: EvalContext, path: string) {
  const callee = unwrap(child(node, "callee"));

  const args = children(node, "arguments").map((a) =>
    evaluateValue(a, ctx, path)
  );

  if (callee.type === "Identifier") {
    const helper = ctx.helpers.get(text(callee, "name"));
    const out = evaluateHelperCall(helper, args, ctx, node, path);

    if (out !== null) {
      return out;
    }
  }

  if (callee.type === "MemberExpression") {
    const obj = unwrap(child(callee, "object"));
    const prop = optText(child(callee, "property"), "name");

    if (
      obj.type === "Identifier" &&
      ctx.helpers.get(text(obj, "name")) === "css" &&
      prop === "keyframes"
    ) {
      const [frames] = args;

      if (!isPlain(frames)) {
        return fail(
          "KEYFRAMES_NEEDS_OBJECT",
          `css.keyframes() needs an object literal.`,
          ctx,
          node,
          path
        );
      }

      // SAFETY: css.keyframes() is typed to take offset -> style object, so
      // the type checker has already checked the argument.
      return ctx.onKeyframes(frames as Record<string, StyleObject>, node);
    }
  }

  if (
    callee.type === "MemberExpression" &&
    optText(child(callee, "property"), "name") === "alpha"
  ) {
    return evaluateAlpha(callee, args, ctx, node, path);
  }

  return fail(
    "CALL_NOT_STATIC",
    `Function calls inside styles are limited to dp(), dph(), columns(), cssVars(), css.keyframes(), and .alpha() on a colour token.`,
    ctx,
    node,
    path
  );
}

function spreadInto(
  out: StyleObject,
  prop: AstNode,
  ctx: EvalContext,
  path: string
) {
  function locate(key: string) {
    ctx.locations?.set(path ? `${path}.${key}` : key, {
      start: prop.start,
      end: prop.end,
    });
  }

  const spread = evaluateValue(child(prop, "argument"), ctx, path);

  if (isTypeLeaf(spread)) {
    const tokens = findTokens(ctx);

    if (!tokens) {
      return fail(
        "TOKENS_NOT_LOADED",
        `Type presets need the tokens module.`,
        ctx,
        prop,
        path
      );
    }

    const expanded = expandPreset(spread, tokens, ctx, prop, path);

    for (const [key, value] of Object.entries(expanded)) {
      locate(key);
      assignStyle(out, key, value);
    }
  } else if (isPlain(spread)) {
    for (const [key, value] of Object.entries(spread)) {
      locate(key);
      // SAFETY: the spread object is evaluated from static source, and
      // normalize() checks every value it reads.
      assignStyle(out, key, value as StyleValue);
    }
  } else {
    fail(
      "SPREAD_NOT_STATIC",
      `Only plain objects and type presets can be spread into a style.`,
      ctx,
      prop,
      path
    );
  }
}

function evaluateObject(
  node: AstNode,
  ctx: EvalContext,
  path: string
): StyleObject {
  const out: StyleObject = {};

  for (const prop of children(node, "properties")) {
    if (prop.type === "SpreadElement") {
      spreadInto(out, prop, ctx, path);
      continue;
    }

    const keyNode = child(prop, "key");

    const key = prop.computed
      ? String(evaluateValue(keyNode, ctx, path))
      : (optText(keyNode, "name") ?? String(keyNode.value));

    const childPath = path ? `${path}.${key}` : key;
    ctx.locations?.set(childPath, { start: prop.start, end: prop.end });
    const valueNode = child(prop, "value");
    const v = evaluateValue(valueNode, ctx, childPath);

    if (isTypeLeaf(v)) {
      fail(
        "PRESET_MUST_SPREAD",
        `Type preset \`${v.key}\` must be spread: \`...t.type.${v.key}\`.`,
        ctx,
        valueNode,
        childPath
      );
    }

    if (hasRef(v)) {
      assignStyle(out, key, v.ref);
    } else if (isFunction(v)) {
      fail(
        "VALUE_NOT_STATIC",
        `Functions are not allowed in styles. Use a recipe for variants or cssVars() for runtime values.`,
        ctx,
        valueNode,
        childPath
      );
    } else {
      // SAFETY: the value is evaluated from static source, and normalize()
      // checks every value it reads.
      assignStyle(out, key, v as StyleValue);
    }
  }

  return out;
}

export function evaluateValue(
  rawNode: AstNode,
  ctx: EvalContext,
  path: string
): unknown {
  const node = unwrap(rawNode);

  switch (node.type) {
    case "Literal": {
      return node.value;
    }

    case "TemplateLiteral": {
      return evaluateTemplate(node, ctx, path);
    }

    case "UnaryExpression": {
      return evaluateUnary(node, ctx, path);
    }

    case "BinaryExpression": {
      return evaluateBinary(node, ctx, path);
    }

    case "Identifier": {
      return evaluateIdentifier(node, ctx, path);
    }

    case "MemberExpression": {
      return evaluateMember(node, ctx, path);
    }

    case "CallExpression": {
      return evaluateCall(node, ctx, path);
    }

    case "ObjectExpression": {
      return evaluateObject(node, ctx, path);
    }

    case "ArrayExpression": {
      return children(node, "elements").map((e) => evaluateValue(e, ctx, path));
    }

    case "ConditionalExpression":
    case "LogicalExpression": {
      return fail(
        "VALUE_NOT_STATIC",
        `Conditional values are not allowed in styles. Put each state in a recipe variant, or use Solid's class array: class={[s.base, open() && s.open]}.`,
        ctx,
        node,
        path
      );
    }

    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      return fail(
        "VALUE_NOT_STATIC",
        `Functions are not allowed in styles. Declare a cssVars() property and set it from the style prop.`,
        ctx,
        node,
        path
      );
    }

    default: {
      return fail(
        "EXPRESSION_NOT_STATIC",
        `\`${node.type}\` cannot be evaluated at build time.`,
        ctx,
        node,
        path
      );
    }
  }
}

/** Whether a value is a `defineTokens()` result. */
export function isTokens(value: unknown): value is Tokens {
  return typeof value === "object" && value !== null && TOKENS_MARK in value;
}

function findTokens(ctx: EvalContext): Tokens | null {
  return Object.values(ctx.tokenExports ?? {}).find(isTokens) ?? null;
}

export function evaluateStyle(
  node: AstNode,
  ctx: EvalContext,
  path: string
): StyleObject {
  const v = evaluateValue(node, ctx, path);

  if (!isPlain(v)) {
    return fail(
      "STYLE_NEEDS_OBJECT",
      `Expected a style object here.`,
      ctx,
      node,
      path
    );
  }

  // SAFETY: the value is evaluated from static source, and normalize()
  // checks every value it reads.
  return v as StyleObject;
}
