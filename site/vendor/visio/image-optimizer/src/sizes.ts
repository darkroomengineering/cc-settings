/** The viewport widths in CSS px the selection covers: the a11y floor up to a 4K monitor at 1x. */
const VIEWPORT_RANGE: readonly [number, number] = [320, 3840];

type Condition = { kind: "max" | "min"; px: number } | null;

interface Term {
  unit: "vw" | "px";
  n: number;
}

export const BY_RATIO = "by-ratio";

/** One comma-separated part of a `sizes` attribute, as `parseSizes()` reads it. */
export interface Entry {
  condition: Condition;
  /** The value is the minimum of these terms; `BY_RATIO` for `width / height`, where the image's ratio and the screen height decide. */
  terms: Term[] | typeof BY_RATIO;
}

/** Splits on `separator` outside parentheses. */
export function splitTop(text: string, separator = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (ch === separator && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }

  out.push(text.slice(start));

  return out
    .values()
    .map((s) => s.trim())
    .filter(Boolean)
    .toArray();
}

function parseTerm(text: string): Term | null {
  const groups = /^(?<n>\d*\.?\d+)(?<unit>vw|px)$/v.exec(text.trim())?.groups;
  const unit = groups?.unit;

  if (unit !== "vw" && unit !== "px") {
    return null;
  }

  return { unit, n: Number(groups?.n) };
}

function parseValue(text: string): Entry["terms"] | null {
  const [width, height] = splitTop(text, "/");

  if (height !== undefined) {
    return width && parseValue(width) ? BY_RATIO : null;
  }

  const inner = /^min\((?<inner>.*)\)$/v.exec(text)?.groups?.inner;
  const parts = inner === undefined ? [text] : splitTop(inner);
  const terms: Term[] = [];

  for (const part of parts) {
    const term = parseTerm(part);

    if (!term) {
      return null;
    }

    terms.push(term);
  }

  return terms.length ? terms : null;
}

/** The entries of a `sizes` attribute, or null when any part is not in the readable subset. */
export function parseSizes(sizes: string): Entry[] | null {
  const entries: Entry[] = [];

  for (const raw of splitTop(sizes)) {
    const groups =
      /^(?:\((?<kind>max|min)-width:\s*(?<px>\d*\.?\d+)px\)\s+)?(?<value>.+)$/v.exec(
        raw
      )?.groups;

    if (!groups) {
      return null;
    }

    const { kind, px, value } = groups;

    if (value === undefined) {
      throw new Error(
        "[@visio/image-optimizer] a sizes entry that matches always has a value."
      );
    }

    const terms = parseValue(value.trim());

    if (terms === null) {
      return null;
    }

    const condition: Condition =
      kind === "max" || kind === "min" ? { kind, px: Number(px) } : null;

    entries.push({ condition, terms });
  }

  return entries.length ? entries : null;
}

/** The rendered width in CSS px at a viewport width, per the attribute's rules. */
export function renderedWidth(entries: Entry[], viewport: number): number {
  for (const { condition, terms } of entries) {
    if (condition?.kind === "max" && viewport > condition.px) {
      continue;
    }

    if (condition?.kind === "min" && viewport < condition.px) {
      continue;
    }

    // `contain` can draw narrower and `cover` wider, by a height the build never sees.
    if (terms === BY_RATIO) {
      return Number.NaN;
    }

    return Math.min(
      ...terms.map((t) => (t.unit === "vw" ? (t.n / 100) * viewport : t.n))
    );
  }

  // No entry applied: the browser falls back to 100vw.
  return viewport;
}

/**
 * The smallest and largest width the attribute renders across the viewport
 * range. Every value is non-decreasing in the viewport, so the extremes sit
 * at the range ends and on either side of each condition's boundary.
 */
export function renderedRange(entries: Entry[]) {
  const [lo, hi] = VIEWPORT_RANGE;
  const probes = new Set([lo, hi]);

  for (const { condition } of entries) {
    if (!condition) {
      continue;
    }

    for (const v of [condition.px - 1, condition.px, condition.px + 1]) {
      probes.add(Math.min(hi, Math.max(lo, v)));
    }
  }

  let min = Number.POSITIVE_INFINITY;
  let max = 0;

  for (const v of probes) {
    const w = renderedWidth(entries, v);

    if (Number.isNaN(w)) {
      return { min: 0, max: Number.POSITIVE_INFINITY };
    }

    if (w < min) {
      min = w;
    }

    if (w > max) {
      max = w;
    }
  }

  return { min, max };
}
