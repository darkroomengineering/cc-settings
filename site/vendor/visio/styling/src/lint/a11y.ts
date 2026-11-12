import { HIT_AREA_INSET } from "../presets.ts";
import { A11Y, screenStops } from "../tokens/index.ts";
import type { ScreenStop, Tokens } from "../tokens/index.ts";
import type { Finding, Located } from "./report.ts";

export interface A11yContext {
  tokens: Tokens;
  /** How styled JSX elements compose their blocks, from the compiler. */
  compositions?: LocatedComposition[];
}

export interface LocatedComposition {
  file: string;
  /** Style block paths in `class` array order; a later block wins per property. */
  blocks: string[];
  /** The nearest styled DOM ancestor's blocks, when the file shows it. */
  parent?: string[];
}

/** Where a design is measured: its narrowest viewport against its width. */
interface Point {
  stop: ScreenStop;
  /** Index into the stops, ascending. */
  index: number;
  /** Viewport width the value was measured at. */
  viewport: number;
  /** Design width it was measured against. */
  design: number;
  /** False when a design px is a fixed `1rem / 16`, the same on any viewport. */
  fluid: boolean;
}

/** A declaration with the screen it belongs to: the index of the widest screen condition it nests under. */
type Tagged = Located & { screen: number };

interface Env {
  points: Point[];
  /** Screen condition name -> index into the stops. */
  screens: Map<string, number>;
}

const TARGET_HEIGHTS = ["height", "min-height", "block-size", "min-block-size"];
const TARGET_WIDTHS = ["width", "min-width", "inline-size", "min-inline-size"];

const CROSS_MARGINS = [
  "margin-top",
  "margin-bottom",
  "margin-block-start",
  "margin-block-end",
];

const PADDING_TOP = ["padding-top", "padding-block-start"];
const PADDING_BOTTOM = ["padding-bottom", "padding-block-end"];

function fromOf(stop: ScreenStop): number {
  if (stop.from === undefined) {
    throw new Error(
      `[@visio/styling] Screen \`${stop.name}\` comes after mobile but has no \`from\`.`
    );
  }

  return stop.from;
}

function makeEnv(ctx: A11yContext): Env {
  const stops = screenStops(ctx.tokens.source);
  const screens = new Map(stops.map((s, i) => [s.condition ?? "", i]));
  screens.delete("");

  const fluid = ctx.tokens.source.fluid ?? true;

  const points = stops.map((stop, index) => ({
    stop,
    index,
    viewport: index === 0 ? A11Y.minViewport : fromOf(stop),
    design: stop.width,
    fluid,
  }));

  return { points, screens };
}

/** Tags every declaration with its screen: the widest screen condition among its conditions, else mobile. */
function tag(all: Located[], env: Env): Tagged[] {
  return all.map((d) => {
    let screen = 0;

    for (const c of d.conds) {
      screen = Math.max(screen, env.screens.get(c) ?? 0);
    }

    return { ...d, screen };
  });
}

/** The authoring path without its screen segments, so `a.desktop.fontSize` and `a.fontSize` pair up. */
function pathWithoutScreens(path: string, env: Env) {
  return path
    .split(".")
    .filter((s) => !env.screens.has(s))
    .join(".");
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function at(n: number, p: Point) {
  return p.fluid ? (n * p.viewport) / p.design : n;
}

function where(p: Point) {
  if (!p.fluid) {
    return `on ${p.stop.name}`;
  }

  return p.index === 0
    ? `at a ${p.viewport}px viewport`
    : `at the ${p.viewport}px breakpoint`;
}

/** The token that moves a screen's start. */
function startOf(p: Point) {
  return `screens.${p.stop.name}.from`;
}

const HIT_AREA_SIDES: Record<"tall" | "wide", readonly string[]> = {
  tall: ["inset-block-start", "inset-block-end"],
  wide: ["inset-inline-start", "inset-inline-end"],
};

/** A side of the `::before` that `HIT_AREA` spreads into a block. */
function isHitAreaSide(d: Located): boolean {
  return (
    d.selector === "&::before" &&
    d.value === HIT_AREA_INSET &&
    Object.values(HIT_AREA_SIDES).some((sides) => sides.includes(d.prop))
  );
}

const OVERFLOW = ["overflow-x", "overflow-y"];

/** Whether `HIT_AREA` makes the target at least 44px on an axis at a point, whatever the box measures. */
function hitAreaCovers(
  decls: Tagged[],
  axis: keyof typeof HIT_AREA_SIDES,
  p: Point
) {
  // Any overflow but `visible` clips the `::before` to the box.
  const clipped = OVERFLOW.some((prop) => {
    const value = valueOn(
      decls.filter((d) => !d.selector),
      prop,
      p
    );

    return value !== null && value !== "visible";
  });

  return (
    !clipped &&
    HIT_AREA_SIDES[axis].every((side) => {
      const pick = pickOn(
        decls.filter((d) => d.prop === side && d.selector === "&::before"),
        p
      );

      return pick !== undefined && isHitAreaSide(pick);
    })
  );
}

/** Everything in one style block, keyed by the authoring path without the property. */
interface Block {
  file: string;
  path: string;
  decls: Tagged[];
}

function blocks(all: Tagged[], env: Env): Map<string, Block> {
  const out = new Map<string, Block>();

  for (const d of all) {
    const hit = isHitAreaSide(d);

    // Only the element's own resting styles size a target, and HIT_AREA's pseudo-element.
    if ((d.selector && !hit) || d.conds.some((c) => !env.screens.has(c))) {
      continue;
    }

    const segments = pathWithoutScreens(d.path, env).split(".");
    segments.pop();

    if (hit) {
      segments.pop();
    }

    const path = segments.join(".");
    const key = `${d.file}|${path}`;
    let b = out.get(key);

    if (!b) {
      out.set(key, (b = { file: d.file, path, decls: [] }));
    }

    b.decls.push(d);
  }

  return out;
}

const SIZING_PROPS = new Set([
  ...TARGET_HEIGHTS,
  ...TARGET_WIDTHS,
  ...PADDING_TOP,
  ...PADDING_BOTTOM,
  "font-size",
  "line-height",
]);

function composed(block: Block, all: Map<string, Block>): Tagged[] | null {
  const segments = block.path.split(".");

  if (segments[1] !== "variants") {
    return block.decls;
  }

  const base = all.get(`${block.file}|${segments[0]}.base`);

  if (!base) {
    return block.decls;
  }

  if (!block.decls.some((d) => SIZING_PROPS.has(d.prop))) {
    return null;
  }

  const own = new Set(block.decls.map(slot));

  return [...base.decls.filter((d) => !own.has(slot(d))), ...block.decls];
}

/** The declaration in effect at a point: the one from the widest screen at or below it. */
function pickOn(matching: Tagged[], p: Point): Tagged | undefined {
  let best: Tagged | undefined;

  for (const d of matching) {
    if (d.screen <= p.index && (!best || d.screen > best.screen)) {
      best = d;
    }
  }

  return best;
}

/** A plain (unscaled) value of `prop` at a point. */
function valueOn(decls: Tagged[], prop: string, p: Point): string | null {
  const pick = pickOn(
    decls.filter((d) => d.prop === prop),
    p
  );

  return pick ? pick.value : null;
}

/** The element or its `::before`, and the property. */
function slot(d: Tagged) {
  return `${d.selector ?? ""}|${d.prop}`;
}

function identity(d: Tagged) {
  return `${slot(d)}|${d.screen}`;
}

/**
 * Later blocks win per property and screen, the way a recipe variant wins
 * over its base. Screens are separate: a wider screen's atoms come after
 * every narrower atom in the sheet, so a later block's base value never
 * beats an earlier block's `desktop` value, and a later `desktop` value leaves the
 * mobile one alone.
 */
function mergeBlocks(parts: Tagged[][]): Tagged[] {
  let out: Tagged[] = [];

  for (const decls of parts) {
    const own = new Set(decls.map(identity));
    out = [...out.filter((d) => !own.has(identity(d))), ...decls];
  }

  return out;
}

/** The scaled design number of `props` at a point. */
function scaledOn(decls: Tagged[], props: string[], p: Point): number | null {
  const pick = pickOn(
    decls.filter((d) => props.includes(d.prop) && d.meta?.kind === "dp"),
    p
  );

  return pick?.meta?.n ?? null;
}

/** A unitless line-height at a point. */
function lineHeightOn(decls: Tagged[], p: Point): number | null {
  const pick = pickOn(
    decls.filter((d) => d.prop === "line-height"),
    p
  );

  if (!pick || !/^\d*\.?\d+$/v.test(pick.value)) {
    return null;
  }

  return Number(pick.value);
}

interface Measure {
  px: number;
  p: Point;
  how: string;
}

/** A fixed size on the axis is the author's call and does not scale, so there is nothing to check. */
function fixedOn(decls: Tagged[], props: string[]) {
  return decls.some((d) => props.includes(d.prop) && !d.meta);
}

/**
 * The height a stretched child gets from its parent: a grid row from a single
 * scaled `grid-auto-rows`, or a scaled flex row minus its vertical padding.
 * Null when the parent sizes rows some other way or the child opts out.
 */
function parentHeight(
  decls: Tagged[],
  parent: Tagged[],
  parentPath: string,
  p: Point
): Measure | null {
  const alignSelf = valueOn(decls, "align-self", p);

  if (alignSelf && alignSelf !== "stretch" && alignSelf !== "auto") {
    return null;
  }

  // Out of flow, or centred by auto margins: the parent's track does not size it.
  const position = valueOn(decls, "position", p);

  if (position === "absolute" || position === "fixed") {
    return null;
  }

  if (CROSS_MARGINS.some((m) => valueOn(decls, m, p) === "auto")) {
    return null;
  }

  const alignItems = valueOn(parent, "align-items", p);

  if (alignItems && alignItems !== "stretch" && alignItems !== "normal") {
    return null;
  }

  const display = valueOn(parent, "display", p);

  if (display === "grid" || display === "inline-grid") {
    return gridRowHeight(parent, parentPath, p);
  }

  if (display === "flex" || display === "inline-flex") {
    return flexRowHeight(parent, parentPath, p);
  }

  return null;
}

function gridRowHeight(
  parent: Tagged[],
  parentPath: string,
  p: Point
): Measure | null {
  if (parent.some((d) => d.prop === "grid-template-rows")) {
    return null;
  }

  const row = scaledOn(parent, ["grid-auto-rows"], p);

  if (row === null) {
    return null;
  }

  return {
    px: at(row, p),
    p,
    how: `grid-auto-rows dp(${row}) of \`${parentPath}\` in the ${p.design} design`,
  };
}

function flexRowHeight(
  parent: Tagged[],
  parentPath: string,
  p: Point
): Measure | null {
  const direction = valueOn(parent, "flex-direction", p);

  if (direction && direction !== "row" && direction !== "row-reverse") {
    return null;
  }

  if (fixedOn(parent, [...TARGET_HEIGHTS, ...PADDING_TOP, ...PADDING_BOTTOM])) {
    return null;
  }

  const height = scaledOn(parent, TARGET_HEIGHTS, p);

  if (height === null) {
    return null;
  }

  const top = scaledOn(parent, PADDING_TOP, p) ?? 0;
  const bottom = scaledOn(parent, PADDING_BOTTOM, p) ?? 0;

  return {
    px: at(height - top - bottom, p),
    p,
    how: `the dp(${height}) tall flex row \`${parentPath}\` minus its padding in the ${p.design} design`,
  };
}

function measureHeight(
  decls: Tagged[],
  p: Point,
  ctx: A11yContext,
  parent?: { decls: Tagged[]; path: string }
): Measure | null {
  if (fixedOn(decls, TARGET_HEIGHTS)) {
    return null;
  }

  const explicit = scaledOn(decls, TARGET_HEIGHTS, p);

  if (explicit !== null) {
    return {
      px: at(explicit, p),
      p,
      how: `height dp(${explicit}) in the ${p.design} design`,
    };
  }

  if (parent) {
    const stretched = parentHeight(decls, parent.decls, parent.path, p);

    if (stretched) {
      return stretched;
    }
  }

  const top = scaledOn(decls, PADDING_TOP, p);
  const bottom = scaledOn(decls, PADDING_BOTTOM, p);
  const font = scaledOn(decls, ["font-size"], p);
  const lh = lineHeightOn(decls, p);

  if (top === null || bottom === null || font === null || lh === null) {
    return null;
  }

  const fontPx = Math.max(at(font, p), A11Y.minFontSize);
  const px = at(top, p) + at(bottom, p) + fontPx * lh;

  return {
    px,
    p,
    how: `padding ${top} + ${bottom} and a ${font}px line at ${lh} in the ${p.design} design`,
  };
}

function measureWidth(decls: Tagged[], p: Point): Measure | null {
  if (fixedOn(decls, TARGET_WIDTHS)) {
    return null;
  }

  const explicit = scaledOn(decls, TARGET_WIDTHS, p);

  if (explicit === null) {
    return null;
  }

  return {
    px: at(explicit, p),
    p,
    how: `width dp(${explicit}) in the ${p.design} design`,
  };
}

interface Target {
  file: string;
  /** `a + b` for a composition, the block path otherwise. */
  path: string;
  decls: Tagged[];
  parent?: { decls: Tagged[]; path: string };
  locations: { file: string; path: string }[];
}

/**
 * What the report measures: every element composition the compiler saw
 * (its blocks merged in array order, its parent's when known), then every
 * block no element composes, on its own.
 */
function targets(all: Tagged[], ctx: A11yContext, env: Env): Target[] {
  const byKey = blocks(all, env);
  const out: Target[] = [];
  const composedIn = new Set<string>();
  const seen = new Set<string>();

  // A composition only names blocks of its own file, so a block the report
  // has no resting declarations for (a focus ring, a hover-only block) is an
  // empty layer of the box, not an unknown one.
  function resolve(file: string, paths: string[]) {
    return paths.map((b) => byKey.get(`${file}|${b}`)?.decls ?? []);
  }

  for (const c of ctx.compositions ?? []) {
    for (const b of c.blocks) {
      composedIn.add(`${c.file}|${b}`);
    }

    const parent = c.parent
      ? {
          decls: mergeBlocks(resolve(c.file, c.parent)),
          path: c.parent.join(" + "),
        }
      : undefined;

    const path = c.blocks.join(" + ");
    const key = `${c.file}|${path}|${parent?.path ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push({
      file: c.file,
      path,
      decls: mergeBlocks(resolve(c.file, c.blocks)),
      parent,
      locations: c.blocks.map((b) => ({ file: c.file, path: b })),
    });
  }

  for (const block of byKey.values()) {
    if (composedIn.has(`${block.file}|${block.path}`)) {
      continue;
    }

    const decls = composed(block, byKey);

    if (!decls) {
      continue;
    }

    out.push({
      file: block.file,
      path: block.path,
      decls,
      locations: [{ file: block.file, path: block.path }],
    });
  }

  return out;
}

function targetFindings(all: Tagged[], ctx: A11yContext, env: Env): Finding[] {
  const { minTarget } = A11Y;
  const findings: Finding[] = [];
  // The same blocks under two parents can measure the same; say it once.
  const said = new Set<string>();

  for (const target of targets(all, ctx, env)) {
    const { decls } = target;

    if (!decls.some((d) => d.prop === "cursor" && d.value === "pointer")) {
      continue;
    }

    for (const [axis, measure] of [
      ["tall", (p: Point) => measureHeight(decls, p, ctx, target.parent)],
      ["wide", (p: Point) => measureWidth(decls, p)],
    ] as const) {
      const candidates = env.points
        .filter((p) => !hitAreaCovers(decls, axis, p))
        .map(measure)
        .filter((m) => m !== null);

      const [worst] = candidates.toSorted((a, b) => a.px - b.px);

      if (!worst || worst.px >= minTarget) {
        continue;
      }

      let remedy = "Raise the size or make it fixed.";

      if (!worst.p.fluid) {
        remedy = "Raise the size.";
      } else if (worst.p.index > 0) {
        remedy = `Raise the size, raise ${startOf(worst.p)}, or make it fixed.`;
      }

      const message = `\`${target.path}\` is a pointer target about ${round(worst.px)}px ${axis} ${where(worst.p)} (${worst.how}). WCAG 2.5.8 asks for ${minTarget}px. ${remedy} Or spread \`HIT_AREA\` into it, which grows the target and keeps the layout.`;
      const key = `${message}|${target.locations.map((l) => `${l.file}:${l.path}`).join(",")}`;

      if (said.has(key)) {
        continue;
      }

      said.add(key);
      findings.push({
        code: "TARGET_TOO_SMALL",
        message,
        locations: target.locations,
      });
    }
  }

  return findings;
}

export function a11yFindings(all: Located[], ctx: A11yContext): Finding[] {
  const env = makeEnv(ctx);
  const tagged = tag(all, env);

  return targetFindings(tagged, ctx, env);
}
