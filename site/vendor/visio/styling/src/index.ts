import type * as CSS from "csstype";

import type { REJECTED, UNITLESS_PROPS } from "./compiler/props.ts";
import type { RouteTheme } from "./route-themes.ts";

export { columns, cssVars, dp, dph } from "./helpers.ts";

export type { CssVar, CssVarSpec } from "./helpers.ts";

export { GRID, HIT_AREA, SR_ONLY } from "./presets.ts";

export { sizes } from "./sizes.ts";

export {
  restoreTheme,
  setTheme,
  theme,
  THEME_SCRIPT,
  toggleTheme,
} from "./theme.ts";

export type { Theme } from "./theme.ts";

export { routeThemes } from "./route-themes.ts";

export type { Register, RouteTheme, RouteThemes } from "./route-themes.ts";

export type { DesignWidth, SizesOptions } from "./sizes.ts";

export { defineTokens, viewport } from "./tokens/index.ts";

export type {
  ColorLeaf,
  FontSource,
  FontToken,
  Layout,
  Responsive,
  Screen,
  Screens,
  ScreenStop,
  ScaledLeaf,
  TokenSource,
  Tokens,
  TypePreset,
  VarLeaf,
} from "./tokens/index.ts";

/** A style value: a literal, a token leaf, or a typed custom property. */
export type Value = string | number | { readonly ref: string };

/**
 * A value for a property with units: a bare number is only `0`. Write
 * `dp(16)` for a scaled size or `'16px'` for a fixed one.
 */
export type UnitValue = string | 0 | { readonly ref: string };

type Camel<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<Camel<Tail>>}`
  : S;

type Unitless = Camel<(typeof UNITLESS_PROPS)[number]>;

declare const rejected: unique symbol;

/** A key the compiler rejects. No value fits it; the type names what to write instead. */
export interface Rejected<Fix extends string> {
  readonly [rejected]: Fix;
}

type Shorthands = {
  [
    K in keyof typeof REJECTED as Camel<K>
  ]?: Rejected<`Use ${(typeof REJECTED)[K]}`>;
};

export type CSSProperties = {
  [
    K in Exclude<
      keyof CSS.PropertiesFallback,
      keyof Shorthands | "scrollBehavior"
    >
  ]?: K extends Unitless ? Value : UnitValue;
} & Shorthands & {
    /** `smooth` makes the router's scroll reset glide: use `scrollTo()` from @visio/scroll. */
    scrollBehavior?:
      | "auto"
      | CSS.Globals
      | { readonly ref: string }
      | Rejected<"No smooth: the router resets the scroll in one step, use scrollTo()">;
  } & {
    [custom: `--${string}`]: Value;
  };

/**
 * Condition keys available inside `css()`. The screens and `hover` always
 * exist. A project adds its themes and custom conditions by augmenting this
 * interface once, in the tokens file:
 *
 *   declare module '@visio/styling' { interface Conditions { dark: Style; reduced: Style } }
 */
export interface Conditions {
  tablet: Style;
  desktop: Style;
  widescreen: Style;
  hover: Style;
}

/**
 * Nested selector keys. `&` is the element: `'&:active'`, `'& > *'`,
 * `'.parent:focus-within &'`. A key without `&` is a suffix: `':focus-visible'`,
 * `'::after'`, `'[aria-current]'`.
 */
export type Selector =
  | `:${string}`
  | `&${string}`
  | `[${string}`
  | `>${string}`
  | `+${string}`
  | `~${string}`
  | `${string}&${string}`;

/**
 * Declarations emitted as written: none of the compiler's rules or lint
 * apply, and the report lists each one. Values must still be static.
 *
 *   unsafe: { transitionProperty: 'grid-template-rows', gridTemplateRows: '0fr' }
 */
export interface UnsafeStyle {
  [property: string]: Value;
}

export type Style = CSSProperties & { [K in keyof Conditions]?: Style } & {
  [S in Selector]?: Style;
} & { unsafe?: UnsafeStyle };

export type StyleMap = Record<string, Style>;

export interface RecipeOptions<
  V extends Record<string, Record<string, Style>>,
> {
  base?: Style;
  variants?: V;
  compound?: {
    when: { [K in keyof V]?: keyof V[K] | boolean };
    style: Style;
  }[];
  defaults?: { [K in keyof V]?: keyof V[K] | boolean };
}

export type RecipeArgs<V extends Record<string, Record<string, Style>>> = {
  [K in keyof V]?: keyof V[K] | boolean | null | undefined;
};

export interface CssApi {
  /**
   * Static styles. Returns one class string per key. Only the keys are
   * inferred, so each style is checked as a `Style`: an unknown property or
   * condition is a type error.
   */
  <K extends string>(styles: Record<K, Style>): { readonly [P in K]: string };
  /** Variant styles. Returns a function that merges base and chosen variants by property. */
  recipe: <V extends Record<string, Record<string, Style>>>(
    options: RecipeOptions<V>
  ) => (args?: RecipeArgs<V>) => string;
  /** Global rules keyed by selector. Lands in the `base` layer. */
  global: (rules: Record<string, Style>) => void;
  /** Keyframes. Returns the animation name. */
  keyframes: (frames: Record<string, CSSProperties>) => string;
}

function notCompiled(): never {
  throw new Error(
    "[@visio/styling] css() was called at runtime: the styling compiler did not run. Build with visio() in vite.config.ts, which adds it."
  );
}

function cssNotCompiled<K extends string>(
  _styles: Record<K, Style>
): { readonly [P in K]: string } {
  return notCompiled();
}

export const css: CssApi = Object.assign(cssNotCompiled, {
  recipe: notCompiled,
  global: notCompiled,
  keyframes: notCompiled,
});

declare module "@visio/router/internal/extend" {
  interface MetaExtension {
    /** The page's theme, with routeThemes() in `extensions`: `light` or a theme of the tokens. */
    theme?: RouteTheme;
  }
}
