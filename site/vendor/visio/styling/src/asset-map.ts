import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { SourceMapSegment } from "@jridgewell/sourcemap-codec";

export interface SheetPosition {
  /** Offset of the sheet's first byte in the asset. */
  index: number;
  /** Zero-based line the sheet starts on. */
  line: number;
  /** Zero-based column on that line. */
  column: number;
}

/**
 * Where `sheet` appears verbatim in `asset`, or null when it does not.
 * Anything in front of the sheet, whitespace included, moves the map; a
 * trailing newline the bundler dropped does not matter.
 */
export function locateSheet(
  asset: string,
  sheet: string
): SheetPosition | null {
  const needle = sheet.trimEnd();

  if (!needle) {
    return null;
  }

  const index = asset.indexOf(needle);

  if (index === -1) {
    return null;
  }

  const before = asset.slice(0, index);
  const line = before.split("\n").length - 1;
  const column = index - (before.lastIndexOf("\n") + 1);

  return { index, line, column };
}

function hasMappings(v: unknown): v is { mappings: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "mappings" in v &&
    typeof v.mappings === "string"
  );
}

/** Moves every generated position down `line` lines and, on the first line, right `column` columns. */
export function shiftMap(map: string, line: number, column: number): string {
  if (line === 0 && column === 0) {
    return map;
  }

  const parsed: unknown = JSON.parse(map);

  if (!hasMappings(parsed)) {
    throw new Error("[@visio/styling] The sheet's source map has no mappings.");
  }

  const lines = decode(parsed.mappings);
  const shifted: SourceMapSegment[][] = Array.from({ length: line }, () => []);

  for (const [i, segments] of lines.entries()) {
    if (i !== 0 || column === 0) {
      shifted.push(segments);
      continue;
    }

    shifted.push(
      segments.map((seg) => {
        // SAFETY: a copy of a segment has the same length, so it is the same tuple.
        const moved = [...seg] as SourceMapSegment;
        moved[0] = seg[0] + column;

        return moved;
      })
    );
  }

  return JSON.stringify({ ...parsed, mappings: encode(shifted) });
}
