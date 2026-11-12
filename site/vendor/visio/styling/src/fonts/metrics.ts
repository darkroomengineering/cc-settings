import { subsetTtf } from "./harfbuzz-subset.ts";
import { readFontMetrics } from "./tables.ts";
import type { FallbackFace, FontMetrics } from "./types.ts";

type Row = readonly [
  family: string,
  unitsPerEm: number,
  ascent: number,
  descent: number,
  lineGap: number,
  xWidthAvg: number,
  local: readonly string[],
];

function table(rows: readonly Row[]): Record<string, FontMetrics> {
  return Object.fromEntries(
    rows.map(
      ([
        familyName,
        unitsPerEm,
        ascent,
        descent,
        lineGap,
        xWidthAvg,
        local,
      ]) => [
        familyName.toLowerCase(),
        {
          familyName,
          unitsPerEm,
          ascent,
          descent,
          lineGap,
          xWidthAvg,
          local: [...local],
        },
      ]
    )
  );
}

/** Menlo and Monaco measured with readFontMetrics on macOS 26 files; the rest from capsize (MIT). */
export const FALLBACK_METRICS: Record<string, FontMetrics> = table([
  ["Arial", 2048, 1854, -434, 67, 913, ["Arial", "ArialMT"]],
  ["Helvetica", 2048, 1577, -471, 0, 913, ["Helvetica"]],
  [
    "Helvetica Neue",
    1000,
    952,
    -213,
    28,
    450,
    ["Helvetica Neue", "HelveticaNeue"],
  ],
  ["Segoe UI", 2048, 2210, -514, 0, 908, ["Segoe UI", "SegoeUI"]],
  ["Roboto", 2048, 1900, -500, 0, 911, ["Roboto Regular", "Roboto-Regular"]],
  ["Verdana", 2048, 2059, -430, 0, 1049, ["Verdana"]],
  ["Trebuchet MS", 2048, 1923, -455, 0, 934, ["Trebuchet MS", "TrebuchetMS"]],
  [
    "Times New Roman",
    2048,
    1825,
    -443,
    87,
    832,
    ["Times New Roman", "TimesNewRomanPSMT"],
  ],
  ["Georgia", 2048, 1878, -449, 0, 913, ["Georgia"]],
  ["Courier New", 2048, 1705, -615, 0, 1229, ["Courier New", "CourierNewPSMT"]],
  ["Menlo", 2048, 1901, -483, 0, 1234, ["Menlo Regular", "Menlo-Regular"]],
  ["Monaco", 2048, 2048, -512, 171, 1230, ["Monaco"]],
]);

/** The bold face of each family in FALLBACK_METRICS that has one, from capsize (MIT). Menlo and Monaco have no row. */
export const FALLBACK_BOLD_METRICS: Record<string, FontMetrics> = table([
  ["Arial", 2048, 1854, -434, 67, 983, ["Arial Bold", "Arial-BoldMT"]],
  ["Helvetica", 2048, 1577, -471, 0, 983, ["Helvetica Bold", "Helvetica-Bold"]],
  [
    "Helvetica Neue",
    1000,
    975,
    -217,
    29,
    480,
    ["Helvetica Neue Bold", "HelveticaNeue-Bold"],
  ],
  ["Segoe UI", 2048, 2210, -514, 0, 973, ["Segoe UI Bold", "SegoeUI-Bold"]],
  ["Roboto", 2048, 1900, -500, 0, 926, ["Roboto Bold", "Roboto-Bold"]],
  ["Verdana", 2048, 2059, -430, 0, 1170, ["Verdana Bold", "Verdana-Bold"]],
  [
    "Trebuchet MS",
    2048,
    1923,
    -455,
    0,
    976,
    ["Trebuchet MS Bold", "TrebuchetMS-Bold"],
  ],
  [
    "Times New Roman",
    2048,
    1825,
    -443,
    87,
    886,
    ["Times New Roman Bold", "TimesNewRomanPS-BoldMT"],
  ],
  ["Georgia", 2048, 1878, -449, 0, 1062, ["Georgia Bold", "Georgia-Bold"]],
  [
    "Courier New",
    2048,
    1705,
    -615,
    0,
    1229,
    ["Courier New Bold", "CourierNewPS-BoldMT"],
  ],
]);

/** Metrics of an OTF, TTF, or the first face of a TTC; of the pinned instance when `axes` is given. */
export async function fontMetrics(
  bytes: Uint8Array,
  axes?: Record<string, number>
): Promise<FontMetrics> {
  const face =
    axes && Object.keys(axes).length
      ? await subsetTtf(bytes, "all", axes)
      : bytes;

  return readFontMetrics(face);
}

/** Metrics of a locally installed family from the table, its bold face when `bold` and the table has one, or null when it is not covered. */
export function fallbackMetrics(
  family: string,
  bold = false
): FontMetrics | null {
  const clean = family
    .trim()
    .replaceAll(/^["']|["']$/gv, "")
    .toLowerCase();

  return (
    (bold ? FALLBACK_BOLD_METRICS[clean] : undefined) ??
    FALLBACK_METRICS[clean] ??
    null
  );
}

/** Splits a CSS `font-family` list into its families, quotes removed. */
export function familiesOf(stack: string): string[] {
  return stack
    .split(",")
    .map((f) => f.trim().replaceAll(/^["']|["']$/gv, ""))
    .filter(Boolean);
}

function pct(n: number): string {
  return `${Number((n * 100).toFixed(4))}%`;
}

/**
 * The descriptors that make `fallback` take up the space of `source`.
 * Same arithmetic as capsize's `createFontStack`: scale the fallback until
 * its average character is as wide as the source's, then express the
 * source's vertical metrics in the scaled fallback's em.
 */
export function fallbackFace(
  source: FontMetrics,
  fallback: FontMetrics
): FallbackFace {
  const sizeAdjust =
    source.xWidthAvg /
    source.unitsPerEm /
    (fallback.xWidthAvg / fallback.unitsPerEm);

  const em = source.unitsPerEm * sizeAdjust;

  return {
    family: fallback.familyName,
    local: fallback.local ?? [fallback.familyName],
    sizeAdjust: pct(sizeAdjust),
    ascentOverride: pct(source.ascent / em),
    descentOverride: pct(Math.abs(source.descent) / em),
    lineGapOverride: pct(source.lineGap / em),
  };
}

/** The first family in `stack` with known metrics, matched to `source`, or null. */
export function matchFallback(
  source: FontMetrics,
  stack: string,
  bold = false
): FallbackFace | null {
  for (const family of familiesOf(stack)) {
    const metrics = fallbackMetrics(family, bold);

    if (metrics) {
      return fallbackFace(source, metrics);
    }
  }

  return null;
}
