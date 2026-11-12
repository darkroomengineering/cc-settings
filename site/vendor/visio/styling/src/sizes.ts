import { group } from "./compiler/match.ts";
import { hasRef, isNumber, isString } from "./guards.ts";
import { columnWidth } from "./helpers.ts";
import { onScreen, resolveResponsive, screenStops } from "./tokens/index.ts";
import type { ScreenStop } from "./tokens/index.ts";
import type { Responsive, TokenSource } from "./tokens/types.ts";

/** A design width: px, `dp(n)`, `columns(n)`, or `t.layout.col`-like leaf. */
export type DesignWidth = number | string | { readonly ref: string };

export interface SizesOptions {
  /** The box's height: `dp(n)`, `dph(n)`, `'320px'`, a viewport height such as `'100svh'`, or `calc()` of them. */
  height: Responsive<string>;
}

const PX = /^(?<n>-?\d*\.?\d+)px$/v;

const DP = /^calc\((?<n>-?\d*\.?\d+) \* var\(--dp\)\)$/v;

const COLS =
  /^calc\((?<n>\d*\.?\d+) \* var\(--col\) \+ \d*\.?\d+ \* var\(--gap\)\)$/v;

function stopNamed(stops: ScreenStop[], screen: string): ScreenStop {
  const stop = stops.find((s) => s.name === screen);

  if (!stop) {
    throw new Error(`sizes(): no screen named "${screen}" in the tokens.`);
  }

  return stop;
}

/** One column in design px on a screen: the fluid formula with `--frame` at the design width. */
function columnPx(
  tokens: TokenSource,
  stops: ScreenStop[],
  stop: ScreenStop
): number {
  function at(v: Responsive<number>) {
    return onScreen(resolveResponsive(v, stops), stop.name);
  }

  const { columns, gap, safe } = tokens.layout;

  return columnWidth(stop.width, at(columns), at(gap), at(safe));
}

function unreadable(value: DesignWidth): Error {
  return new Error(
    `sizes() cannot read ${JSON.stringify(value)}. Use a design px number, dp(n), columns(n), t.layout.col, or a fixed '320px'.`
  );
}

function widthText(value: DesignWidth): string | null {
  if (isString(value)) {
    return value;
  }

  return hasRef(value) ? value.ref : null;
}

/** The design px a width resolves to on a screen (`mobile`, `desktop`, or another from the tokens). */
export function designPx(
  tokens: TokenSource,
  value: DesignWidth,
  screen: string
): number {
  const stops = screenStops(tokens);
  const stop = stopNamed(stops, screen);

  if (isNumber(value)) {
    return value;
  }

  const str = widthText(value);

  if (str === null) {
    throw unreadable(value);
  }

  if (str === "0px") {
    return 0;
  }

  if (str === "var(--col)") {
    return columnPx(tokens, stops, stop);
  }

  if (str === "var(--frame)") {
    return stop.width;
  }

  const dp = DP.exec(str);

  if (dp) {
    return Number(group(dp, "n"));
  }

  const cols = COLS.exec(str);

  if (cols) {
    const n = Number(group(cols, "n"));

    const gap = onScreen(
      resolveResponsive(tokens.layout.gap, stops),
      stop.name
    );

    return n * columnPx(tokens, stops, stop) + (n - 1) * gap;
  }

  const px = PX.exec(str);

  if (px) {
    return Number(group(px, "n"));
  }

  throw unreadable(str);
}

/** Whether a width follows the frame without fluid scaling: a column span or the frame itself. */
function stretches(value: DesignWidth): boolean {
  const str = widthText(value);

  return (
    str === "var(--col)" ||
    str === "var(--frame)" ||
    (str !== null && COLS.test(str))
  );
}

function isFixed(value: DesignWidth): boolean {
  const str = widthText(value);

  return str !== null && PX.test(str);
}

/** The span of a `columns(n)` width, or null for any other width. */
function spanOf(value: DesignWidth): number | null {
  const str = widthText(value);

  if (str === "var(--col)") {
    return 1;
  }

  const cols = str === null ? null : COLS.exec(str);

  return cols ? Number(group(cols, "n")) : null;
}

/** A width as the call would write it, for the fix a message suggests. */
function written(value: DesignWidth): string {
  const str = widthText(value);

  if (str === null) {
    return JSON.stringify(value);
  }

  if (str === "var(--col)") {
    return "t.layout.col";
  }

  if (str === "var(--frame)") {
    return "t.layout.frame";
  }

  const span = spanOf(value);
  const dp = DP.exec(str);

  if (span !== null) {
    return `columns(${span})`;
  }

  return dp ? `dp(${group(dp, "n")})` : `'${str}'`;
}

/** Rejects a column span wider than the grid of a screen it applies to, with the whole value that fits. */
function checkSpans(
  tokens: TokenSource,
  stops: ScreenStop[],
  widths: Record<string, DesignWidth>
) {
  const counts = resolveResponsive(tokens.layout.columns, stops);
  const wide: string[] = [];

  const fixed = stops.map((stop) => {
    const w = onScreen(widths, stop.name);
    const span = spanOf(w);
    const count = onScreen(counts, stop.name);

    if (span === null || span <= count) {
      return `${stop.name}: ${written(w)}`;
    }

    wide.push(
      `columns(${span}) is wider than the ${count} columns of ${stop.name}`
    );

    return `${stop.name}: columns(${count})`;
  });

  if (wide.length > 0) {
    throw new Error(
      `sizes(): ${wide.join(", and ")}, so the browser would fetch a file wider than the image. Give each screen a span that fits: sizes({ ${fixed.join(", ")} }).`
    );
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

const DP_IN = /calc\((?<n>-?\d*\.?\d+) \* var\(--dp\)\)/gv;

const DPH_IN = /calc\((?<n>-?\d*\.?\d+) \* var\(--dph\)\)/gv;

const HEIGHT_CHARS = /^[\d.\s+\-*\/\(\),a-z]+$/v;

const HEIGHT_UNITS = new Set(["px", "vw", "vh", "svh", "dvh", "lvh"]);

const HEIGHT_WORDS = new Set([...HEIGHT_UNITS, "calc", "min", "max"]);

const BARE_UNIT = /(?<![\d.a-z])(?:px|vw|vh|svh|dvh|lvh)\b/v;

/** Whether `/` appears outside parentheses, where `<Image>` reads it as the end of the width. */
function topLevelSlash(text: string): boolean {
  let depth = 0;

  for (const ch of text) {
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (ch === "/" && depth === 0) {
      return true;
    }
  }

  return false;
}

/** Thrown for a `height` that `sizes()` cannot read, so the compiler reports it with its own code. */
export class SizesHeightError extends Error {
  override name = "SizesHeightError";
}

/** A height as a `sizes` length on one screen: `dp()` and `dph()` resolved, as `--dp` and `--dph` resolve them. */
function heightOn(
  tokens: TokenSource,
  value: string,
  stop: ScreenStop,
  last: boolean
): string {
  const max = tokens.layout.maxWidth;
  const fluid = tokens.fluid ?? true;

  const out = value
    .replaceAll(DP_IN, (_, n: string) => {
      const share = round((Number(n) / stop.width) * 100);

      if (!fluid) {
        return `${n}px`;
      }

      // `--frame` is `min(100vw, maxWidth)`.
      return last && max !== undefined
        ? `min(${share}vw, ${round((Number(n) * max) / stop.width)}px)`
        : `${share}vw`;
    })
    .replaceAll(DPH_IN, (_, n: string) =>
      fluid ? `${round((Number(n) / stop.height) * 100)}vh` : `${n}px`
    );

  const words = out.match(/[a-z]+/gv) ?? [];

  if (
    !HEIGHT_CHARS.test(out) ||
    words.some((w) => !HEIGHT_WORDS.has(w)) ||
    !words.some((w) => HEIGHT_UNITS.has(w)) ||
    BARE_UNIT.test(out) ||
    topLevelSlash(out)
  ) {
    throw new SizesHeightError(
      `sizes() cannot read the height ${JSON.stringify(value)}. Use dp(n), dph(n), a fixed '320px', a viewport height such as '100svh', or calc() of them: \`calc(100svh - \${dp(144)})\`.`
    );
  }

  return out;
}

/**
 * The `sizes` attribute for an image that is `width` wide in the design,
 * from a token source. This is what the compiler writes in place of `sizes()`.
 */
export function sizesFor(
  tokens: TokenSource,
  width: Responsive<DesignWidth>,
  options?: SizesOptions
): string {
  const stops = screenStops(tokens);
  const widths = resolveResponsive(width, stops);
  checkSpans(tokens, stops, widths);
  const heights = options && resolveResponsive(options.height, stops);
  const max = tokens.layout.maxWidth;
  const fluid = tokens.fluid ?? true;

  // Widest first with `min-width`, as the sheet's `@media (width >= from)`:
  // `max-width: from - 1` leaves a gap at fractional viewport widths.
  return stops
    .map((stop, i) => {
      const w = onScreen(widths, stop.name);
      const px = designPx(tokens, w, stop.name);
      const share = round((px / stop.width) * 100);

      // Columns stretch with the window either way; with fluid off the
      // gaps in them do not, so the share is exact only at the design width.
      let value = `${share}vw`;

      // `'320px'` is fixed, as in `css()`; so is any design px with fluid off.
      if (isFixed(w) || (!fluid && !stretches(w))) {
        value = `${round(px)}px`;
      } else if (i === stops.length - 1 && max !== undefined) {
        value = `min(${share}vw, ${round((px * max) / stop.width)}px)`;
      }

      // `<Image>` turns `width / height` into the width at the image's ratio.
      if (heights) {
        const last = i === stops.length - 1;
        value = `${value} / ${heightOn(tokens, onScreen(heights, stop.name), stop, last)}`;
      }

      return stop.from === undefined
        ? value
        : `(min-width: ${stop.from}px) ${value}`;
    })
    .toReversed()
    .join(", ");
}

/**
 * The `sizes` attribute for an image that is `width` wide in the design.
 *
 *   sizes({ mobile: columns(4), desktop: columns(6) })
 *   // '(min-width: 800px) min(48.33vw, 609px), 91.47vw'
 *   sizes(dp(320))
 *
 * A single value applies to every screen, as it does in `css()`; a screen
 * without a value takes the nearest smaller one's. The plugin compiles the
 * call to that string, so the argument must be static: the fluid helpers,
 * tokens, numbers, or a top-level const.
 */
export function sizes(
  _width: Responsive<DesignWidth>,
  _options?: SizesOptions
): string {
  throw new Error(
    "[@visio/styling] sizes() was called at runtime: the styling compiler did not run. Build with visio() in vite.config.ts, which adds it."
  );
}
