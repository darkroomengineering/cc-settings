import type { FluidKind, FluidValue } from "./fluid-value.ts";
import { ampersands, topLevel } from "./selector.ts";

export { FluidValue } from "./fluid-value.ts";

/** A value that came out of a type preset spread. The type preset rule trusts these. */
export class PresetValue {
  readonly value: string | number;
  readonly preset: string;
  /** The design number behind a scaled preset value, for the report. */
  readonly meta?: FluidMeta;
  constructor(value: string | number, preset: string, meta?: FluidMeta) {
    this.value = value;
    this.preset = preset;
    this.meta = meta;
  }
}

/** Evaluated style object: property/condition keys with nested objects. */
export type StyleValue =
  | string
  | number
  | PresetValue
  | FluidValue
  | StyleObject
  | undefined
  | null
  | false;

export interface StyleObject {
  [key: string]: StyleValue;
}

export interface FluidMeta {
  kind: FluidKind;
  n: number;
}

/** Byte offsets of the authoring property in its source file. */
export interface SourceSpan {
  start: number;
  end: number;
}

/** One flattened CSS declaration with its full context. */
export interface Declaration {
  /** kebab-case property */
  prop: string;
  value: string;
  /** Condition names, in the order they were nested (outer first). */
  conds: string[];
  /** Selector template with `&` for the element (`&:hover`, `.parent &`), empty for none. */
  selector: string;
  /** Dotted authoring path for diagnostics. */
  path: string;
  fromPreset?: string;
  /** Present when the value came from a fluid helper. */
  meta?: FluidMeta;
  /** Where the property was written, when known. */
  loc?: SourceSpan;
  /** Written under `unsafe`: emitted as authored, exempt from the value rules and the lint. */
  unsafe?: boolean;
}

/** The first declaration that produced an atom, for source maps. */
export interface AtomOrigin {
  file: string;
  offset: number;
}

export interface Atom {
  key: string;
  className: string;
  prop: string;
  value: string;
  conds: string[];
  selector: string;
  origin?: AtomOrigin;
}

/** A condition resolved from the tokens table. */
export interface Condition {
  name: string;
  /** `@media (...)`, `@supports (...)`, `@container (...)`, or empty. */
  atRule: string;
  /** Selector template containing `&`, or empty. */
  selector: string;
}

export function parseCondition(name: string, raw: string): Condition {
  const trimmed = raw.trim();

  if (trimmed.startsWith("@")) {
    const idx =
      preludeEnd(trimmed) ??
      ampersands(trimmed).find((at) => trimmed[at - 1] === " ");

    if (idx === undefined) {
      return { name, atRule: trimmed, selector: "" };
    }

    return {
      name,
      atRule: trimmed.slice(0, idx).trim(),
      selector: trimmed.slice(idx).trim(),
    };
  }

  return { name, atRule: "", selector: trimmed };
}

// The at-rule ends at a closing parenthesis that no `and`, `or` or `(` goes on
// from: `@media (hover: hover) and (pointer: fine) .card:hover &` splits after
// `fine)`, not at the `&`, which would leave `.card:hover` in the query.
function preludeEnd(text: string): number | undefined {
  if (!hasAmpAfter(text, 0)) {
    return undefined;
  }

  let index = 0;

  for (const [ch, top, literal] of topLevel(text)) {
    index += ch.length;

    if (ch !== ")" || !top || literal) {
      continue;
    }

    const rest = text.slice(index).trimStart();

    if (
      rest &&
      !/^(?:and|or|not)\b|^\(/v.test(rest) &&
      hasAmpAfter(text, index)
    ) {
      return index;
    }
  }

  return undefined;
}

function hasAmpAfter(text: string, from: number): boolean {
  return ampersands(text).some((at) => at >= from);
}
