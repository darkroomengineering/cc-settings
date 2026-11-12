import { HOVER_MEDIA, mentionsHover } from "../compiler/selector.ts";
import type { Subset } from "../fonts/index.ts";
import { columnWidth, tokenVarName } from "../helpers.ts";
import type { Style } from "../index.ts";
import type {
  FontSource,
  Responsive,
  Screen,
  Screens,
  TokenSource,
  TypePreset,
} from "./types.ts";
import { configureViewport, dpPx, viewport } from "./viewport.ts";

export type {
  FontSource,
  FontToken,
  Layout,
  Responsive,
  Screen,
  Screens,
  TokenSource,
  TypePreset,
} from "./types.ts";

export { viewport } from "./viewport.ts";

export interface VarLeaf<V = string> {
  /** `--colors-ink` */
  readonly name: string;
  /** `var(--colors-ink)` */
  readonly ref: string;
  readonly value: V;
  toString: () => string;
}

export interface ColorLeaf extends VarLeaf {
  /** The colour at `amount` opacity, 0 to 1, as a `color-mix()` that follows the theme. */
  alpha: (amount: number) => string;
}

export interface ScaledLeaf extends VarLeaf<Record<string, number>> {
  /** Current pixel size, from the viewport store. */
  px: () => number;
}

/** `--frame`: the width the design scales against, `min(100vw, layout.maxWidth)`. */
export interface FrameLeaf extends VarLeaf<number | null> {
  /** Current frame width in px. */
  px: () => number;
}

export interface FontLeaf extends VarLeaf<string> {
  readonly family: string;
  /**
   * URL of the first file as shipped, for preloads and WebGL text: the first
   * source, and the first entry of its `subset` list.
   */
  readonly url: string;
  /** One URL per shipped file: `sources` in order, each source's `subset` list in order. */
  readonly urls: readonly string[];
}

/**
 * Runtime marker for a type preset. Typed as `Style` so `...t.type.mono`
 * spreads cleanly; the compiler recognises the marker and expands it.
 */
export interface TypeLeaf {
  readonly kind: "preset";
  readonly key: string;
  readonly preset: TypePreset;
}

/** What the styling plugin passes as the hidden second argument of `defineTokens()`. */
export interface TokensRuntime {
  /** Font key -> URL per file, in the order of `FontLeaf.urls`. */
  fontUrls?: Record<string, readonly string[]>;
}

type ScaledMap<T> = { readonly [K in keyof T]: ScaledLeaf };

type VarMap<T> = { readonly [K in keyof T]: VarLeaf };

type ColorLeafMap<T> = { readonly [K in keyof T]: ColorLeaf };

type FontMap<T> = { readonly [K in keyof T]: FontLeaf };

type TypeMap<T> = { readonly [K in keyof T]: Style };

export interface Tokens<S extends TokenSource = TokenSource> {
  readonly source: S;
  readonly screens: S["screens"];
  /** The designs in ascending order: mobile, then every other screen by where it starts. */
  readonly stops: readonly ScreenStop[];
  readonly layout: {
    readonly gap: ScaledLeaf;
    readonly safe: ScaledLeaf;
    /** One column width, as `var(--col)`. Use `columns(n)` for spans. */
    readonly col: ScaledLeaf;
    /** Column count per screen. */
    readonly columns: Record<string, number>;
    /** `var(--frame)`: `min(100vw, layout.maxWidth)`. Use it as a max-width to centre content once scaling stops. */
    readonly frame: FrameLeaf;
  };
  readonly sizes: ScaledMap<NonNullable<S["sizes"]>>;
  readonly colors: ColorLeafMap<S["colors"]>;
  readonly easings: VarMap<NonNullable<S["easings"]>>;
  readonly fonts: FontMap<NonNullable<S["fonts"]>>;
  readonly type: TypeMap<NonNullable<S["type"]>>;
  /** Condition name -> at-rule prelude or selector. Includes the screens, themes, and user conditions. */
  readonly conditions: Record<string, string>;
}

export const TOKENS_MARK = Symbol.for("@visio/styling:tokens");

/** One design and where it starts. */
export interface ScreenStop {
  name: keyof Screens;
  width: number;
  height: number;
  /** Viewport width in px the design starts at. The mobile base has none. */
  from?: number;
  /** Its condition in `css()`: the screen's name. None for mobile. */
  condition?: string;
}

export const SCREEN_NAMES: readonly string[] = [
  "mobile",
  "tablet",
  "desktop",
  "widescreen",
] satisfies (keyof Screens)[];

/**
 * The designs in ascending order: mobile first, then every other screen by
 * `from`. Throws on a screen that cannot be placed, so a bad tokens file
 * fails when it is loaded, not when a value is missing.
 */
export function screenStops(source: TokenSource): ScreenStop[] {
  const { screens } = source;

  const taken = [
    ...Object.keys(source.themes ?? {}),
    ...Object.keys(source.conditions ?? {}),
  ].find((name) => SCREEN_NAMES.includes(name));

  if (taken !== undefined) {
    throw new Error(
      `[@visio/styling] \`${taken}\` is a screen name, so it cannot name a theme or a condition. Rename it.`
    );
  }

  const rest: (ScreenStop & { from: number })[] = [];

  // SAFETY: the loop rejects any key that is not a screen name first.
  const entries = Object.entries(screens) as [
    keyof Screens,
    Screen & { from?: number },
  ][];

  for (const [name, screen] of entries) {
    if (!SCREEN_NAMES.includes(name)) {
      throw new Error(
        `[@visio/styling] screens.${name}: the screens are ${SCREEN_NAMES.join(", ")}. Use the one nearest to the design.`
      );
    }

    if (name === "mobile") {
      if (screen.from !== undefined) {
        throw new Error(
          "[@visio/styling] screens.mobile is the base design and takes no `from`."
        );
      }

      continue;
    }

    const { from } = screen;

    if (from === undefined) {
      throw new Error(
        `[@visio/styling] screens.${name} needs \`from\`: the viewport width in px where that design starts.`
      );
    }

    rest.push({
      name,
      width: screen.width,
      height: screen.height,
      from,
      condition: name,
    });
  }

  rest.sort((a, b) => a.from - b.from);

  for (const [i, stop] of rest.entries()) {
    const prev = i > 0 ? rest[i - 1] : undefined;

    if (prev?.from === stop.from) {
      throw new Error(
        `[@visio/styling] screens.${prev.name} and screens.${stop.name} both start at ${stop.from}px.`
      );
    }
  }

  return [
    {
      name: "mobile",
      width: screens.mobile.width,
      height: screens.mobile.height,
    },
    ...rest,
  ];
}

/**
 * A responsive value per screen, in stop order. A screen without a value of
 * its own takes the nearest smaller screen's, so a two-value pair still
 * describes every design.
 */
export function resolveResponsive<T>(
  v: Responsive<T>,
  stops: readonly ScreenStop[]
): Record<string, T> {
  const per = isSingle(v) ? null : v;
  let last = isSingle(v) ? v : v.mobile;

  for (const key of Object.keys(per ?? {})) {
    if (!stops.some((s) => s.name === key)) {
      throw new Error(
        `[@visio/styling] A per-screen value names \`${key}\`, a screen the tokens do not define. Add \`screens.${key}\` with its \`from\`, or drop the value.`
      );
    }
  }

  return Object.fromEntries(
    stops.map((s) => {
      const own = per?.[s.name];

      if (own !== undefined) {
        last = own;
      }

      return [s.name, last];
    })
  );
}

function isSingle<T>(v: Responsive<T>): v is T {
  return v === null || typeof v !== "object" || !("mobile" in v);
}

export function onScreen<T>(values: Record<string, T>, screen: string): T {
  const v = values[screen];

  if (v === undefined) {
    throw new Error(
      `[@visio/styling] No value for screen \`${screen}\`; it is not one of the token stops.`
    );
  }

  return v;
}

function leaf<V>(name: string, value: V): VarLeaf<V> {
  const ref = `var(${name})`;

  return { name, ref, value, toString: () => ref };
}

function color(name: string, value: string): ColorLeaf {
  const base = leaf(name, value);

  return {
    ...base,
    alpha(amount) {
      if (!(amount >= 0 && amount <= 1)) {
        throw new RangeError(
          `[@visio/styling] alpha(${amount}) on ${name} needs an amount from 0 to 1.`
        );
      }

      return `color-mix(in srgb, ${base.ref} ${Math.round(amount * 1000) / 10}%, transparent)`;
    },
  };
}

function scaled(
  name: string,
  value: Responsive<number>,
  stops: readonly ScreenStop[]
): ScaledLeaf {
  const v = resolveResponsive(value, stops);
  const base = leaf(name, v);

  return {
    ...base,
    px() {
      return onScreen(v, viewport.screen) * dpPx();
    },
  };
}

/**
 * What the report checks scaling against, and the font-size floor. The
 * floor holds every scaled font size at `minFontSize`, so text never
 * renders smaller.
 */
export const A11Y = {
  minViewport: 320,
  minFontSize: 12,
  minTarget: 24,
} as const;

/** A font source's subsets, one per shipped file: the list, or the single value (`undefined` for none). */
export function faces(
  source: FontSource
): readonly (Subset | "used" | undefined)[] {
  const { subset } = source;

  return isSubsetList(subset) ? subset : [subset];
}

function isSubsetList(
  subset: FontSource["subset"]
): subset is readonly [Subset, ...Subset[]] {
  return Array.isArray(subset);
}

function mapLeaves<T extends Record<string, unknown>, R>(
  obj: T | undefined,
  fn: (key: string, value: T[keyof T]) => R
): Record<string, R> {
  if (!obj) {
    return {};
  }

  return Object.fromEntries(
    Object.keys(obj).map((key) => {
      // SAFETY: `key` comes from Object.keys(obj), so it is a key of T.
      const value = obj[key] as T[keyof T];

      return [key, fn(key, value)];
    })
  );
}

/**
 * Builds the condition table: the screens by width, one per theme, `hover`,
 * then user conditions. The order is the order groups are emitted in, so a
 * wider screen's rule wins.
 */
export function buildConditions(source: TokenSource): Record<string, string> {
  const out = new Map<string, string>();

  for (const s of screenStops(source)) {
    if (s.from !== undefined) {
      out.set(s.name, `@media (width >= ${s.from}px)`);
    }
  }

  for (const theme of Object.keys(source.themes ?? {})) {
    out.set(theme, `[data-theme=${theme}] &`);
  }

  out.set("hover", `@media ${HOVER_MEDIA} &:hover`);

  for (const [name, raw] of Object.entries(source.conditions ?? {})) {
    if (mentionsHover(raw) && !raw.trim().startsWith(`@media ${HOVER_MEDIA}`)) {
      throw new Error(
        `[@visio/styling] conditions.${name}: \`:hover\` applies on touch screens too, where a tap leaves it stuck. Start it with \`@media ${HOVER_MEDIA}\`.`
      );
    }

    out.set(name, raw);
  }

  return Object.fromEntries(out);
}

const SOURCE_KEYS = new Set(
  Object.keys({
    screens: true,
    fluid: true,
    layout: true,
    sizes: true,
    colors: true,
    themes: true,
    easings: true,
    fonts: true,
    type: true,
    conditions: true,
  } satisfies Record<keyof TokenSource, true>)
);

export function buildTokens<const S extends TokenSource>(
  source: S,
  runtime: TokensRuntime = {}
): Tokens<S> {
  for (const key of Object.keys(source)) {
    if (key === "breakpoints") {
      throw new Error(
        "[@visio/styling] defineTokens(): `breakpoints` is not a tokens key. Desktop starts at `screens.desktop.from`, and its condition in css() is `desktop`."
      );
    }

    if (!SOURCE_KEYS.has(key)) {
      throw new Error(
        `[@visio/styling] defineTokens(): \`${key}\` is not a tokens key. The keys are ${[...SOURCE_KEYS].join(", ")}.`
      );
    }
  }

  const { screens, layout } = source;
  const stops = screenStops(source);
  const widest = stops.at(-1);

  if (!widest) {
    throw new Error("[@visio/styling] screenStops() returned no screens.");
  }

  const { maxWidth } = layout;

  if (
    maxWidth !== undefined &&
    widest.from !== undefined &&
    maxWidth < widest.from
  ) {
    throw new Error(
      `[@visio/styling] layout.maxWidth (${maxWidth}) must be at least ${widest.from}, where screens.${widest.name} starts.`
    );
  }

  configureViewport(stops, maxWidth, source.fluid ?? true);
  const gap = scaled("--gap", layout.gap, stops);
  const safe = scaled("--safe", layout.safe, stops);
  const columns = resolveResponsive(layout.columns, stops);

  // The `--col` formula with the frame at each design width.
  const colWidths = Object.fromEntries(
    stops.map((s) => [
      s.name,
      columnWidth(
        s.width,
        onScreen(columns, s.name),
        onScreen(gap.value, s.name),
        onScreen(safe.value, s.name)
      ),
    ])
  );

  const col: ScaledLeaf = {
    ...leaf("--col", colWidths),
    px: () =>
      columnWidth(
        viewport.frame,
        onScreen(columns, viewport.screen),
        gap.px(),
        safe.px()
      ),
  };

  const frame: FrameLeaf = {
    ...leaf("--frame", maxWidth ?? null),
    px: () => viewport.frame,
  };

  const tokens = {
    source,
    screens,
    stops,
    layout: { gap, safe, col, columns, frame },
    sizes: mapLeaves(source.sizes, (k, v) =>
      scaled(tokenVarName("sizes", k), v, stops)
    ),
    colors: mapLeaves(source.colors, (k, v) =>
      color(tokenVarName("colors", k), v)
    ),
    easings: mapLeaves(source.easings, (k, v) =>
      leaf(tokenVarName("easings", k), v)
    ),
    fonts: mapLeaves(source.fonts, (k, v) => {
      const urls =
        runtime.fontUrls?.[k] ??
        (v.sources ?? []).flatMap((s) => faces(s).map(() => s.src));

      const base = leaf(tokenVarName("fonts", k), v.family);

      return { ...base, family: v.family, url: urls[0] ?? "", urls };
    }),
    type: mapLeaves(source.type, (k, v) => ({
      kind: "preset" as const,
      key: k,
      preset: v,
    })),
    conditions: buildConditions(source),
  };

  Object.defineProperty(tokens, TOKENS_MARK, { value: true });

  // SAFETY: `tokens` holds every key of Tokens, each built from the same key
  // of `source`, so its keys and leaves are those of Tokens<S>.
  return tokens as Tokens<S>;
}

/**
 * A typed token tree from the design values. The styling plugin adds the
 * shipped font URLs as a second argument, so the public type has one.
 */
// SAFETY: the public signature only narrows what buildTokens accepts.
export const defineTokens = buildTokens as <const S extends TokenSource>(
  source: S &
    Closed<S, TokenSource> & {
      screens: Closed<S["screens"], Screens>;
    }
) => Tokens<S>;

/** `S` with every key `T` does not name typed `never`, since inference skips the excess check. */
type Closed<S, T> = { [K in Exclude<keyof S, keyof T>]: never };
