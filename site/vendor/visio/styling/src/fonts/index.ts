import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { cacheKey, readCache, writeCache } from "./cache.ts";
import { PRESET_RANGES } from "./presets.ts";
import {
  codePoints,
  parseUnicodeRange,
  rangeOfCodePoints,
  subsetFont,
} from "./subset.ts";
import type { OptimizedFont, Subset } from "./types.ts";

export { FALLBACK_METRICS, fontMetrics, matchFallback } from "./metrics.ts";

export type {
  FallbackFace,
  OptimizedFont,
  Subset,
  WeightFallback,
} from "./types.ts";

export function unicodeRangeOf(subset: Subset): string {
  if (typeof subset === "string") {
    const range = PRESET_RANGES[subset];

    if (!range) {
      throw new Error(`[@visio/styling] unknown subset preset "${subset}"`);
    }

    return range;
  }

  if ("unicodeRange" in subset) {
    parseUnicodeRange(subset.unicodeRange);

    return subset.unicodeRange;
  }

  if (!subset.chars) {
    throw new Error("[@visio/styling] the chars subset is empty");
  }

  return rangeOfCodePoints(codePoints(subset.chars));
}

export interface FontOptions {
  /** Path to an OTF or TTF file. HarfBuzz cannot read WOFF. */
  src: string;
  subset: Subset;
  /** Directory for the content-addressed cache. */
  cacheDir: string;
  /**
   * Pins these axes, e.g. `{ wght: 400 }`. Axes not listed stay variable.
   * Throws when the font has no such axis.
   */
  axes?: Record<string, number>;
}

/** Subsets one font file. Cached by content, so repeat calls are a file read. */
export async function optimizeFont(
  options: FontOptions
): Promise<OptimizedFont> {
  try {
    const source = new Uint8Array(readFileSync(options.src));
    const unicodeRange = unicodeRangeOf(options.subset);
    const key = cacheKey(source, unicodeRange, options.axes);
    let bytes = readCache(options.cacheDir, key);
    const cached = bytes !== null;

    if (!bytes) {
      bytes = await subsetFont(source, unicodeRange, options.axes);
      writeCache(options.cacheDir, key, bytes);
    }

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const name = `${path.basename(options.src, path.extname(options.src))}-${hash}.woff2`;

    return { bytes, name, unicodeRange, cached };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).replace(/^\[@visio\/styling\] /v, "");

    throw new Error(`[@visio/styling] ${options.src}: ${message}`, {
      cause: error,
    });
  }
}
