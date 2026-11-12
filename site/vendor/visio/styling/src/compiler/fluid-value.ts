export type FluidKind = "dp" | "dph" | "col";

/**
 * Output of `dp()`, `dph()`, or `columns()` at compile time. Carries the design
 * number so the report never has to parse it back out of the calc string.
 */
export class FluidValue {
  readonly kind: FluidKind;
  readonly n: number;
  readonly css: string;
  constructor(kind: FluidKind, n: number, css: string) {
    this.kind = kind;
    this.n = n;
    this.css = css;
  }
  toString() {
    return this.css;
  }
}
