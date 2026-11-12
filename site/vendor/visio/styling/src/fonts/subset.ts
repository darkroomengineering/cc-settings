import { subsetTtf } from "./harfbuzz-subset.ts";
import { encodeWoff2 } from "./woff2.ts";

/** The code points of a string, one per character. */
export function codePoints(text: string): number[] {
  return [...text].map((ch) => {
    const cp = ch.codePointAt(0);

    if (cp === undefined) {
      throw new Error(
        "[@visio/styling] a character of a string always has a code point"
      );
    }

    return cp;
  });
}

function hex(cp: number) {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

/** Sorted, deduplicated code points as a `unicode-range`, runs collapsed to `U+a-b`. */
export function rangeOfCodePoints(points: Iterable<number>): string {
  const sorted = [...new Set(points)].toSorted((a, b) => a - b);
  const runs: [number, number][] = [];

  for (const cp of sorted) {
    const last = runs.at(-1);

    if (last && cp === last[1] + 1) {
      last[1] = cp;
    } else {
      runs.push([cp, cp]);
    }
  }

  return runs
    .map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`))
    .join(", ");
}

// `U+41`, `U+0041-005A`, or `U+4??`: one to six hex digits.
const PART =
  /^U\+(?:(?<first>[0-9A-F]{1,6})(?:-(?<last>[0-9A-F]{1,6}))?|(?<wild>[0-9A-F]{0,5}\?{1,6}))$/iv;

export function parseUnicodeRange(range: string): [number, number][] {
  if (!range.trim()) {
    throw new Error("[@visio/styling] the unicode-range is empty");
  }

  return range.split(",").map((part) => {
    const trimmed = part.trim();
    const { first, last, wild } = PART.exec(trimmed)?.groups ?? {};
    let start: number;
    let end: number;

    if (wild && wild.length <= 6) {
      start = Number.parseInt(wild.replaceAll("?", "0"), 16);
      end = Number.parseInt(wild.replaceAll("?", "F"), 16);
    } else if (first && !wild) {
      start = Number.parseInt(first, 16);
      end = Number.parseInt(last ?? first, 16);
    } else {
      throw new Error(
        `[@visio/styling] "${trimmed}" in unicode-range "${range}" does not parse; write U+0041 or U+0041-005A`
      );
    }

    if (start > end || end > 0x10_ff_ff) {
      throw new Error(
        `[@visio/styling] "${trimmed}" in unicode-range "${range}" is not a range of code points`
      );
    }

    return [start, end];
  });
}

function expandRangesToCodepoints(pairs: [number, number][]): number[] {
  const codepoints: number[] = [];

  for (const [start, end] of pairs) {
    for (let cp = start; cp <= end; cp += 1) {
      codepoints.push(cp);
    }
  }

  return codepoints;
}

/** Subsets to the code points in `unicodeRange` and returns WOFF2 bytes. */
export async function subsetFont(
  sourceBytes: Uint8Array,
  unicodeRange: string,
  axes?: Record<string, number>
): Promise<Uint8Array> {
  const pairs = parseUnicodeRange(unicodeRange);
  const codepoints = expandRangesToCodepoints(pairs);
  const ttfBytes = await subsetTtf(sourceBytes, codepoints, axes);

  return encodeWoff2(ttfBytes);
}
