import { isNumber } from "../guards.ts";
import { SCREEN_NAMES } from "../tokens/index.ts";
import { error, warning } from "./errors.ts";
import type { Diagnostic } from "./errors.ts";
import { FluidValue, PresetValue } from "./model.ts";
import type {
  Declaration,
  FluidMeta,
  SourceSpan,
  StyleObject,
  StyleValue,
} from "./model.ts";
import {
  EDGE_FAMILIES,
  DISCRETE_PROPS,
  LAYOUT_PROPS,
  REJECTED_SHORTHANDS,
  SHORTHANDS,
  TYPE_METRIC_PROPS,
  UNITLESS,
  toKebab,
} from "./props.ts";
import {
  HOVER_MEDIA,
  hasAmp,
  mentionsHover,
  nest,
  splitList,
  splitTopLevel,
  toTemplate,
} from "./selector.ts";

export interface NormalizeOptions {
  /** Known condition names from the tokens. */
  conditions: Set<string>;
  typography: "open" | "strict";
  file?: string;
  /** Source spans by dotted path, from the evaluator. Missing paths fall back to their parent. */
  locations?: Map<string, SourceSpan>;
  /** Floor scaled font sizes at this many px (emitted in rem). The project passes `A11Y.minFontSize`. */
  fontFloor?: number;
}

export interface NormalizeResult {
  declarations: Declaration[];
  diagnostics: Diagnostic[];
}

function classifyKey(
  key: string,
  conditions: Set<string>
): "condition" | "selector" | "atRule" | "property" | "bareSelector" {
  if (conditions.has(key)) {
    return "condition";
  }

  if (key.startsWith("@")) {
    return "atRule";
  }

  if (
    hasAmp(key) ||
    key.startsWith(":") ||
    key.startsWith("[") ||
    key.includes(" ") ||
    key.startsWith(">") ||
    key.startsWith("~") ||
    key.startsWith("+")
  ) {
    return "selector";
  }

  if (key.startsWith(".") || key.startsWith("#")) {
    return "bareSelector";
  }

  return "property";
}

function needsAmpersand(part: string, file: string | undefined, path: string) {
  return error(
    "SELECTOR_NEEDS_AMPERSAND",
    `\`${part}\` looks like a selector but does not say where the element goes. Write '${part} &' for an ancestor or '& ${part}' for a descendant.`,
    { file, path }
  );
}

function isPlainObject(v: StyleValue): v is StyleObject {
  return (
    typeof v === "object" &&
    v !== null &&
    !(v instanceof PresetValue) &&
    !(v instanceof FluidValue)
  );
}

/** The last segment of a dotted path: the authored key. */
function keyOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

function metaOf(value: StyleValue): FluidMeta | undefined {
  if (value instanceof FluidValue) {
    return { kind: value.kind, n: value.n };
  }

  return value instanceof PresetValue ? value.meta : undefined;
}

function rawOf(value: string | number | PresetValue | FluidValue) {
  if (value instanceof PresetValue) {
    return value.value;
  }

  return value instanceof FluidValue ? value.css : value;
}

/** One edge written through both spellings. */
function edgeDiagnostics(
  declarations: Declaration[],
  file: string | undefined
): Diagnostic[] {
  // Conditions are not exclusive, so any two declarations on the same
  // selector can apply together, and then the stylesheet's order decides,
  // not the author's.
  const edges = new Map<
    string,
    { family: string; physical?: Declaration; logical?: Declaration }
  >();

  for (const d of declarations) {
    if (d.unsafe) {
      continue;
    }

    for (const [family, pairs] of EDGE_FAMILIES) {
      const logical = pairs.get(d.prop);

      const physical = logical
        ? undefined
        : [...pairs].find(([, l]) => l === d.prop)?.[0];

      if (!logical && !physical) {
        continue;
      }

      const edge = `${d.selector}|${family}|${logical ?? d.prop}`;
      const seen = edges.get(edge) ?? { family };

      if (logical) {
        seen.physical ??= d;
      } else {
        seen.logical ??= d;
      }

      edges.set(edge, seen);
    }
  }

  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();

  for (const { family, physical, logical } of edges.values()) {
    if (!physical || !logical) {
      continue;
    }

    const key = `${physical.path}|${logical.path}`;

    if (reported.has(key)) {
      continue;
    }

    reported.add(key);
    diagnostics.push(
      warning(
        "EDGE_SET_TWICE",
        `\`${keyOf(physical.path)}\` and \`${keyOf(logical.path)}\` both write the ${family} of the same edge, one physically and one logically; which wins depends on the stylesheet, not on this order. Set the edges you mean with one spelling.`,
        { file, path: physical.path }
      )
    );
  }

  return diagnostics;
}

function motionDiagnostics(d: Declaration, file: string | undefined) {
  const out: Diagnostic[] = [];

  if (d.prop === "transition-property") {
    const parts = d.value.split(",").map((s) => s.trim());

    const bad = parts.filter(
      (p) => p === "all" || (LAYOUT_PROPS.has(p) && !DISCRETE_PROPS.has(p))
    );

    if (bad.length) {
      out.push(
        error(
          "TRANSITION_ANIMATES_LAYOUT",
          `Transitioning \`${bad.join(", ")}\` forces layout on every frame. Animate transform or opacity, or move the change to a class swap.`,
          { file, path: d.path }
        )
      );
    }
  }

  if (d.prop === "scroll-behavior" && d.value === "smooth") {
    out.push(
      error(
        "SCROLL_BEHAVIOR_SMOOTH",
        `\`scrollBehavior: 'smooth'\` makes the router's scroll reset glide, and it has to land in one step. Remove it, and scroll smoothly from code with scrollTo() from @visio/scroll, which glides with Lenis or without it. A nested scroller marked data-lenis-prevent can take it in \`unsafe\`.`,
        { file, path: d.path }
      )
    );
  }

  if (d.prop === "will-change" && !d.selector && !d.conds.includes("hover")) {
    out.push(
      warning(
        "WILL_CHANGE_STATIC",
        `\`will-change\` in a resting style promotes a layer forever. Set it from a hover or active state, or drop it and let the browser decide.`,
        { file, path: d.path }
      )
    );
  }

  return out;
}

function boxDiagnostics(
  d: Declaration,
  declarations: Declaration[],
  hiddenPaths: Set<string>,
  file: string | undefined
) {
  const out: Diagnostic[] = [];

  if (
    (d.prop === "outline-style" && /^(?:none|hidden)$/iv.test(d.value)) ||
    (d.prop === "outline-width" && Number.parseFloat(d.value) === 0)
  ) {
    out.push(
      error(
        "OUTLINE_REMOVED",
        `\`${keyOf(d.path)}: '${d.value}'\` removes the focus ring the reset draws on \`:focus-visible\`, and a keyboard user loses their place. Remove it, and restyle the ring under a \`':focus-visible'\` key with outlineColor or outlineOffset.`,
        { file, path: d.path }
      )
    );
  }

  if (
    (d.prop === "overflow-x" || d.prop === "overflow-y") &&
    d.value === "hidden" &&
    !hiddenPaths.has(d.path)
  ) {
    hiddenPaths.add(d.path);
    out.push(
      warning(
        "OVERFLOW_HIDDEN",
        `\`${keyOf(d.path)}: 'hidden'\` makes a scroll container, so \`position: sticky\` inside it stops working. Use 'clip'. \`clip\` does not contain floats or margins: a child's negative margin that \`hidden\` cropped (a wordmark cut off at the bottom) now makes the box taller, with no error. On a block box add \`display: 'flow-root'\`; a flex or grid box needs nothing. Keep 'hidden' only for an element scrolled from code, with \`// visio-ignore OVERFLOW_HIDDEN: reason\`.`,
        { file, path: d.path }
      )
    );
  }

  if (d.prop === "content-visibility" && d.value === "auto") {
    const hasSize = declarations.some(
      (o) =>
        o.prop === "contain-intrinsic-size" &&
        o.conds.join(",") === d.conds.join(",") &&
        o.selector === d.selector
    );

    if (!hasSize) {
      out.push(
        warning(
          "CONTENT_VISIBILITY_NEEDS_SIZE",
          `\`content-visibility: auto\` without \`containIntrinsicSize\` makes the scrollbar jump. Add containIntrinsicSize: 'auto 500px'.`,
          { file, path: d.path }
        )
      );
    }
  }

  return out;
}

/** A nested block under a key that is not a condition: a screen the tokens lack, or a property. */
function objectValueError(
  rawKey: string,
  file: string | undefined,
  path: string
): Diagnostic {
  if (rawKey === "dt") {
    return error(
      "SCREEN_NOT_DEFINED",
      "`dt` is now `desktop`: a screen's condition is its name.",
      { file, path }
    );
  }

  if (rawKey === "mobile") {
    return error(
      "SCREEN_NOT_DEFINED",
      "`mobile` is the base design and has no condition: put its values at the top level of the style.",
      { file, path }
    );
  }

  if (SCREEN_NAMES.includes(rawKey)) {
    return error(
      "SCREEN_NOT_DEFINED",
      `\`${rawKey}\` is a screen the tokens do not define. Add \`screens.${rawKey}\` with its \`from\`, or use a screen they define.`,
      { file, path }
    );
  }

  return error(
    "PROPERTY_NEEDS_VALUE",
    `\`${rawKey}\` is a CSS property and needs a string or number, not an object.`,
    { file, path }
  );
}

function blockKeyError(
  rawKey: string,
  kind: "selector" | "atRule" | "bareSelector",
  file: string | undefined,
  childPath: string
): Diagnostic | null {
  if (kind === "bareSelector") {
    return needsAmpersand(rawKey, file, childPath);
  }

  if (kind === "atRule") {
    return error(
      "AT_RULE_REJECTED",
      `Raw at-rule \`${rawKey}\` is not allowed inside css(). Add it to \`conditions\` in the tokens and use the name.`,
      { file, path: childPath }
    );
  }

  if (mentionsHover(rawKey)) {
    return error(
      "HOVER_NEEDS_CONDITION",
      `\`${rawKey}\` applies on touch screens too, where a tap leaves it stuck. Use the \`hover\` condition, or for a hover on a parent add a condition to the tokens: \`cardHover: '@media ${HOVER_MEDIA} .card:hover &'\`.`,
      { file, path: childPath }
    );
  }

  // A class or id part with no `&` is as ambiguous inside a list or
  // next to a combinator as it is on its own.
  const bare = splitList(rawKey).find(
    (part) => !hasAmp(part) && /^[.#]/v.test(part)
  );

  return bare ? needsAmpersand(bare, file, childPath) : null;
}

export function normalize(
  style: StyleObject,
  opts: NormalizeOptions,
  rootPath = ""
): NormalizeResult {
  const declarations: Declaration[] = [];
  const diagnostics: Diagnostic[] = [];
  const { file } = opts;

  // Conditions nest in either order (`desktop: { hover }`, `hover: { desktop }`) and
  // mean one rule, so a declaration keeps them in table order: both
  // spellings share one atom, and the emitter ranks the group by its parts.
  const condOrder = new Map(
    [...opts.conditions].map((c, i) => [c, i] as const)
  );

  function rank(cond: string): number {
    const at = condOrder.get(cond);

    if (at === undefined) {
      throw new Error(
        `[@visio/styling] \`${cond}\` was nested as a condition but is not one.`
      );
    }

    return at;
  }

  function withCond(conds: string[], name: string) {
    return conds.includes(name)
      ? conds
      : [...conds, name].toSorted((a, b) => rank(a) - rank(b));
  }

  function locate(path: string): SourceSpan | undefined {
    const { locations } = opts;

    if (!locations) {
      return undefined;
    }

    let p = path;

    while (p) {
      const loc = locations.get(p);

      if (loc) {
        return loc;
      }

      const dot = p.lastIndexOf(".");
      p = dot === -1 ? "" : p.slice(0, dot);
    }

    return undefined;
  }

  function valueText(
    rawKey: string,
    prop: string,
    raw: string | number,
    childPath: string
  ): string | null {
    if (!isNumber(raw)) {
      return String(raw).trim();
    }

    if (raw === 0 || UNITLESS.has(prop) || prop.startsWith("--")) {
      return String(raw);
    }

    diagnostics.push(
      error(
        "NUMBER_NEEDS_UNIT",
        `\`${rawKey}: ${raw}\` has no unit. Use dp(${raw}) for a scaled size, or '${raw}px' for a fixed one.`,
        { file, path: childPath }
      )
    );

    return null;
  }

  function property(
    rawKey: string,
    value: string | number | PresetValue | FluidValue,
    block: { conds: string[]; selector: string; path: string },
    typed: { presetProps: Set<string>; ownProps: Map<string, string> }
  ) {
    const { conds, selector, path: childPath } = block;
    const prop = toKebab(rawKey);
    const fromPreset = value instanceof PresetValue ? value.preset : undefined;
    const meta = metaOf(value);
    let str = valueText(rawKey, prop, rawOf(value), childPath);

    if (str === null) {
      return;
    }

    // The floor is in rem so the browser's text size setting still applies.
    if (opts.fontFloor && prop === "font-size" && meta?.kind === "dp") {
      str = `max(${str}, ${opts.fontFloor / 16}rem)`;
    }

    if (fromPreset) {
      typed.presetProps.add(prop);
    } else if (TYPE_METRIC_PROPS.has(prop)) {
      typed.ownProps.set(prop, childPath);
    }

    const rejected = REJECTED_SHORTHANDS.get(prop);

    if (rejected !== undefined) {
      diagnostics.push(
        error(
          "SHORTHAND_REJECTED",
          `\`${rawKey}\` bundles several declarations. Use ${rejected} instead.`,
          { file, path: childPath }
        )
      );

      return;
    }

    const expand = SHORTHANDS.get(prop);

    if (!expand) {
      declarations.push({
        prop,
        value: str,
        conds,
        selector,
        path: childPath,
        fromPreset,
        meta,
        loc: locate(childPath),
      });

      return;
    }

    if (splitTopLevel(str, " ").length > 1) {
      const longhands = expand
        .map((p) =>
          p.replaceAll(/-(?<c>[a-z])/gv, (_, c: string) => c.toUpperCase())
        )
        .join(", ");

      diagnostics.push(
        error(
          "SHORTHAND_MULTI_VALUE",
          `\`${rawKey}: '${str}'\` sets several sides at once. Write the longhands: ${longhands}.`,
          { file, path: childPath }
        )
      );

      return;
    }

    const loc = locate(childPath);

    for (const longhand of expand) {
      declarations.push({
        prop: longhand,
        value: str,
        conds,
        selector,
        path: childPath,
        fromPreset,
        meta,
        loc,
      });
    }
  }

  function walk(
    obj: StyleObject,
    conds: string[],
    selector: string,
    path: string
  ) {
    const typed = {
      presetProps: new Set<string>(),
      ownProps: new Map<string, string>(),
    };

    for (const [rawKey, value] of Object.entries(obj)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }

      const childPath = path ? `${path}.${rawKey}` : rawKey;

      if (rawKey === "unsafe" && !opts.conditions.has(rawKey)) {
        unsafeBlock(value, conds, selector, childPath);
        continue;
      }

      const kind = classifyKey(rawKey, opts.conditions);

      if (kind === "condition" || kind === "selector") {
        if (!isPlainObject(value)) {
          diagnostics.push(
            error(
              kind === "condition"
                ? "CONDITION_NEEDS_OBJECT"
                : "SELECTOR_NEEDS_OBJECT",
              `\`${rawKey}\` is a ${kind} and needs a nested style object.`,
              { file, path: childPath }
            )
          );
          continue;
        }

        if (kind === "condition") {
          walk(value, withCond(conds, rawKey), selector, childPath);
          continue;
        }
      }

      if (kind !== "property") {
        const rejected = blockKeyError(rawKey, kind, file, childPath);

        if (rejected) {
          diagnostics.push(rejected);
        } else if (isPlainObject(value)) {
          walk(value, conds, nest(selector, toTemplate(rawKey)), childPath);
        }

        continue;
      }

      if (isPlainObject(value)) {
        diagnostics.push(objectValueError(rawKey, file, childPath));
        continue;
      }

      property(rawKey, value, { conds, selector, path: childPath }, typed);
    }

    if (opts.typography === "strict") {
      for (const [prop, at] of typed.ownProps) {
        const hint = typed.presetProps.size
          ? `This block spreads a type preset; presets own ${prop}. Change the preset or add a new one.`
          : `Spread a type preset from the tokens (\`...t.type.name\`) instead of setting ${prop} directly.`;

        diagnostics.push(
          error(
            "TYPOGRAPHY_NEEDS_PRESET",
            `\`${prop}\` cannot be set directly: a type preset sets it. ${hint}`,
            { file, path: at }
          )
        );
      }
    }
  }

  /** Properties emitted as authored. Only the shape is checked. */
  function unsafeBlock(
    value: StyleValue,
    conds: string[],
    selector: string,
    path: string
  ) {
    if (!isPlainObject(value)) {
      diagnostics.push(
        error(
          "UNSAFE_NEEDS_OBJECT",
          `\`unsafe\` takes an object of properties to emit as written, e.g. unsafe: { padding: '8px 16px' }.`,
          { file, path }
        )
      );

      return;
    }

    for (const [rawKey, v] of Object.entries(value)) {
      if (v === undefined || v === null || v === false) {
        continue;
      }

      const childPath = `${path}.${rawKey}`;

      if (isPlainObject(v)) {
        diagnostics.push(
          error(
            "UNSAFE_NEEDS_PROPERTIES",
            `\`unsafe\` holds properties only, and \`${rawKey}\` is a nested block. Put the unsafe block inside the condition or selector instead: ${rawKey}: { unsafe: { ... } }.`,
            { file, path: childPath }
          )
        );
        continue;
      }

      declarations.push({
        prop: toKebab(rawKey),
        value: String(rawOf(v)).trim(),
        conds,
        selector,
        path: childPath,
        loc: locate(childPath),
        unsafe: true,
      });
    }
  }

  walk(style, [], "", rootPath);

  diagnostics.push(...edgeDiagnostics(declarations, file));
  const hiddenPaths = new Set<string>();

  for (const d of declarations) {
    if (d.unsafe) {
      continue;
    }

    diagnostics.push(
      ...motionDiagnostics(d, file),
      ...boxDiagnostics(d, declarations, hiddenPaths, file)
    );
  }

  return { declarations, diagnostics };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
