import { parseSizes, renderedRange } from "./sizes.ts";

/** The highest device pixel ratio worth serving a sharper candidate to. */
const MAX_DPR = 3;

/**
 * The widths the browser can pick for any of the given `sizes` attributes:
 * those between the smallest rendered width at 1x and the largest at `MAX_DPR`,
 * plus the first candidate above that, or the largest of all when every
 * candidate is too small. Null when a `sizes` value is not readable.
 */
export function selectWidths(
  widths: number[],
  sizes: string[]
): number[] | null {
  const sorted = [...widths].toSorted((a, b) => a - b);
  const largest = sorted.at(-1);

  if (sizes.length === 0 || largest === undefined) {
    return sorted;
  }

  let minNeeded = Number.POSITIVE_INFINITY;
  let maxNeeded = 0;

  for (const value of sizes) {
    const entries = parseSizes(value);

    if (!entries) {
      return null;
    }

    const range = renderedRange(entries);
    minNeeded = Math.min(minNeeded, range.min);
    maxNeeded = Math.max(maxNeeded, range.max * MAX_DPR);
  }

  const kept = sorted.filter((w) => w >= minNeeded && w <= maxNeeded);
  const above = sorted.find((w) => w > maxNeeded);

  if (above !== undefined && kept.at(-1) !== maxNeeded) {
    kept.push(above);
  }

  return kept.length ? kept : [largest];
}
