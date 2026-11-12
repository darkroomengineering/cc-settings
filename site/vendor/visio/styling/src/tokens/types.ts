import type { Subset } from "../fonts/index.ts";

/**
 * A value that differs per design. A plain value applies to every screen.
 * Per screen, `mobile` and `desktop` are required and `tablet` and
 * `widescreen` are optional: a screen without a value takes the nearest
 * smaller screen's.
 */
export type Responsive<T> =
  | T
  | { mobile: T; desktop: T; tablet?: T; widescreen?: T };

/** One design: the artboard size its values were drawn at. */
export interface Screen {
  width: number;
  height: number;
}

/**
 * The designs. `mobile` is the base; every other screen names the viewport
 * width it starts at with `from` and is a condition of its own name in `css()`.
 */
export interface Screens {
  mobile: Screen;
  tablet?: Screen & { from: number };
  desktop: Screen & { from: number };
  widescreen?: Screen & { from: number };
}

export interface Layout {
  columns: Responsive<number>;
  /** Gap between columns, in design px. */
  gap: Responsive<number>;
  /** Safe margin at the viewport edge, in design px. */
  safe: Responsive<number>;
  /** Px. The viewport width past which the design stops scaling; at least the largest screen's `from`. */
  maxWidth?: number;
}

interface FontSourceBase {
  /** With `subset`, a path from the project root; without it, a URL used as written. */
  src: string;
  weight?: string | number;
  style?: "normal" | "italic";
  display?: "swap" | "block" | "fallback" | "optional" | "auto";
}

/** A file used as written. `axes` needs `subset`: the instance is pinned while subsetting. */
export interface WholeFontSource extends FontSourceBase {
  subset?: undefined;
  axes?: undefined;
}

/** A local OTF/TTF file, subsetted and shipped by the styling plugin. */
export interface SubsetFontSource extends FontSourceBase {
  /** A preset, `'used'`, or a list of presets, one file each (styling skill, `references/fonts.md`). */
  subset: Subset | "used" | readonly [Subset, ...Subset[]];
  /** Pins axes of a variable font, `{ wght: 700 }`. Default: the whole variable font. */
  axes?: Record<string, number>;
}

export type FontSource = WholeFontSource | SubsetFontSource;

export interface FontToken {
  family: string;
  fallback?: string;
  /** Default: the first family in `fallback` with known metrics. `false` turns the matched face off. */
  adjust?: string | false;
  /** Emit `@font-face` rules for these files. Omit for system or externally loaded fonts. */
  sources?: FontSource[];
}

/**
 * A complete type style. Every metric property is required so that a preset
 * fully describes a line of text, because a style sets these properties only
 * through a preset.
 */
export interface TypePreset {
  font: string;
  size: Responsive<number>;
  lineHeight: Responsive<number | string>;
  letterSpacing: Responsive<string>;
  weight: Responsive<number | string>;
  style?: "normal" | "italic";
  transform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export type ColorMap = Record<string, string>;

export interface TokenSource {
  screens: Screens;
  /** Default true. `false` makes a design px `1rem / 16`, with no viewport scaling. */
  fluid?: boolean;
  layout: Layout;
  /** Named sizes in design px, scaled with the viewport. */
  sizes?: Record<string, Responsive<number>>;
  colors: ColorMap;
  /** Named colour overrides, applied with `[data-theme=name]`. Each key becomes a condition. */
  themes?: Record<string, Partial<ColorMap>>;
  easings?: Record<string, string>;
  fonts?: Record<string, FontToken>;
  type?: Record<string, TypePreset>;
  /** Extra conditions: an at-rule prelude or a selector with `&`, e.g. `{ reduced: '@media (prefers-reduced-motion: reduce)' }`. */
  conditions?: Record<string, string>;
}
