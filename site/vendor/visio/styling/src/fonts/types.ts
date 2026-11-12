export type SubsetPreset =
  | "latin"
  | "latin-ext"
  | "cyrillic"
  | "cyrillic-ext"
  | "greek"
  | "greek-ext"
  | "vietnamese";

/** A named preset, an explicit `unicode-range`, or the exact characters a font must cover. */
export type Subset =
  | SubsetPreset
  | { unicodeRange: string }
  | { chars: string };

export interface OptimizedFont {
  /** WOFF2 bytes. */
  bytes: Uint8Array;
  /** `<basename>-<hash>.woff2`, stable for the same source, subset, and axes. */
  name: string;
  /** The `unicode-range` the file covers, for the `@font-face` rule. */
  unicodeRange: string;
  cached: boolean;
}

/** What the fallback matcher needs to know about a face, in font units. */
export interface FontMetrics {
  familyName: string;
  unitsPerEm: number;
  ascent: number;
  /** Negative, as in the hhea table. */
  descent: number;
  lineGap: number;
  /** Average advance width of English text, weighted by `LATIN_WEIGHTS`. */
  xWidthAvg: number;
  /**
   * Names `local()` can load the regular face by: the full name and the
   * PostScript name. Browsers do not match on the family name alone.
   */
  local?: string[];
}

/** Descriptors for an `@font-face` that shows a local family in the web font's metrics. */
export interface FallbackFace {
  /** The local family drawn, e.g. `Courier New`. */
  family: string;
  /** Names for `src: local()`, tried in order. */
  local: string[];
  sizeAdjust: string;
  ascentOverride: string;
  descentOverride: string;
  lineGapOverride: string;
}

/** A fallback face for one weight of a font. */
export interface WeightFallback {
  /** The `font-weight` of the web font's source; undefined for a range, so the browser synthesizes bold from the regular face. */
  weight: number | undefined;
  face: FallbackFace;
}
