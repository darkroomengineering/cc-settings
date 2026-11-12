/** `n` design px: `calc(n * var(--dp))`. */
export function dp(px: number): string {
  if (px === 0) {
    return "0px";
  }

  return `calc(${px} * var(--dp))`;
}

/** `n` design px of the height: `calc(n * var(--dph))`. */
export function dph(px: number): string {
  if (px === 0) {
    return "0px";
  }

  return `calc(${px} * var(--dph))`;
}

/** Width of `n` grid columns including the gaps between them. */
export function columns(n: number): string {
  if (n === 1) {
    return "var(--col)";
  }

  return `calc(${n} * var(--col) + ${n - 1} * var(--gap))`;
}

/** The variable a token leaf writes: `--colors-ink`. */
export function tokenVarName(
  group: "colors" | "sizes" | "easings" | "fonts",
  key: string
) {
  return `--${group}-${key}`;
}

/** One column: the frame less both edge margins and the gaps between columns, split evenly. */
export function columnWidth(
  frame: number,
  count: number,
  gap: number,
  safe: number
): number {
  return (frame - 2 * safe - (count - 1) * gap) / count;
}

/** `columnWidth()` in CSS, against the live variables: the value of `--col`. */
export function columnCss(count: number): string {
  return `calc((var(--frame) - 2 * var(--safe) - ${count - 1} * var(--gap)) / ${count})`;
}

export interface CssVarSpec {
  /** `@property` syntax, e.g. `<number>`, `<length>`, `<color>`, `<angle>`. */
  syntax: string;
  initial: string | number;
  inherits?: boolean;
}

export interface CssVar {
  /** `--progress` */
  readonly name: string;
  /** `var(--progress)` */
  readonly ref: string;
  toString: () => string;
}

/** `scrollY` -> `scroll-y`. The compiler uses the same function, so both spell a name alike. */
export function kebab(key: string): string {
  return key.replaceAll(/[A-Z]/gv, (m) => `-${m.toLowerCase()}`);
}

/**
 * Declares typed custom properties. The compiler emits an `@property` rule
 * for each, which makes the value readable from JS in resolved units and
 * animatable on the compositor. Set them from Solid's `style` prop:
 * `style={{ [v.progress.name]: progress() }}`.
 */
export function cssVars<T extends Record<string, CssVarSpec>>(
  spec: T
): { readonly [K in keyof T]: CssVar } {
  const out = Object.fromEntries(
    Object.keys(spec).map((key) => {
      const name = `--${kebab(key)}`;
      const ref = `var(${name})`;
      const value: CssVar = { name, ref, toString: () => ref };

      return [key, value];
    })
  );

  // SAFETY: `out` has one CssVar under every key of `spec`.
  return out as { readonly [K in keyof T]: CssVar };
}
