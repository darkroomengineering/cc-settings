import { parseCondition } from "./model.ts";
import type { Atom, AtomOrigin, Condition } from "./model.ts";
import { SHORTHANDS } from "./props.ts";
import { applyTemplate } from "./selector.ts";

export interface GlobalRule {
  /** The authored selector, e.g. `body` or `a[href]`. */
  selector: string;
  /** Nested selector template applied to `selector`, empty for none. */
  template: string;
  declarations: { prop: string; value: string }[];
  conds: string[];
  origin?: AtomOrigin;
}

export interface Keyframes {
  name: string;
  frames: Record<string, { prop: string; value: string }[]>;
}

export interface PropertyRegistration {
  name: string;
  syntax: string;
  initial: string;
  inherits: boolean;
}

export interface EmitInput {
  conditions: Record<string, string>;
  tokensCss: string;
  resetCss: string;
  atoms: Atom[];
  globals: GlobalRule[];
  keyframes: Keyframes[];
  properties: PropertyRegistration[];
}

export interface EmitResult {
  css: string;
  /** Origin of each line of `css`, by line index, where known. */
  origins: (AtomOrigin | undefined)[];
}

const SHORTHAND_ORDER = new Set(SHORTHANDS.keys());

function propRank(prop: string): number {
  if (prop.startsWith("--")) {
    return 0;
  }

  if (SHORTHAND_ORDER.has(prop)) {
    return 1;
  }

  return 2;
}

/** Code-unit order, the same in every locale. */
function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

function escapeClass(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9_\-]/gv, "\\$&");
}

class Sheet {
  private readonly lines: string[] = [];
  readonly origins: (AtomOrigin | undefined)[] = [];

  push(text: string, origin?: AtomOrigin) {
    if (!text) {
      return;
    }

    const parts = text.split("\n");

    for (const [i, part] of parts.entries()) {
      this.lines.push(part);
      this.origins.push(i === 0 ? origin : undefined);
    }
  }

  toString() {
    return this.lines.join("\n");
  }
}

function selectorFor(base: string, template: string, conds: Condition[]) {
  let sel = applyTemplate(template, base);

  for (const c of conds) {
    if (c.selector) {
      sel = applyTemplate(c.selector, sel);
    }
  }

  return sel;
}

export function emit(input: EmitInput): EmitResult {
  const condTable = new Map<string, Condition>();
  const condOrder = new Map<string, number>();

  for (const [i, [name, raw]] of Object.entries(input.conditions).entries()) {
    condTable.set(name, parseCondition(name, raw));
    condOrder.set(name, i + 1);
  }

  function resolve(names: string[]) {
    return names.map(
      (n) => condTable.get(n) ?? { name: n, atRule: "", selector: "" }
    );
  }

  function groupRank(conds: string[]) {
    const ranks = conds.map((c) =>
      String(condOrder.get(c) ?? 99).padStart(3, "0")
    );

    return `${String(conds.length).padStart(2, "0")}|${ranks.join(".")}`;
  }

  const out = new Sheet();

  function open(layer: string) {
    out.push(`@layer ${layer} {`);
  }

  function close() {
    out.push("}");
  }

  out.push("@layer tokens, reset, base, atoms;");

  for (const p of input.properties) {
    out.push(
      `@property ${p.name} { syntax: "${p.syntax}"; inherits: ${p.inherits}; initial-value: ${p.initial}; }`
    );
  }

  out.push(input.tokensCss);

  if (input.resetCss) {
    open("reset");
    out.push(input.resetCss);
    close();
  }

  if (input.globals.length || input.keyframes.length) {
    open("base");

    for (const kf of input.keyframes) {
      const frames = Object.entries(kf.frames)
        .map(
          ([at, decls]) =>
            `  ${at} { ${decls.map((d) => `${d.prop}: ${d.value};`).join(" ")} }`
        )
        .join("\n");

      out.push(`@keyframes ${kf.name} {\n${frames}\n}`);
    }

    const sortedGlobals = input.globals.toSorted((a, b) =>
      compare(groupRank(a.conds), groupRank(b.conds))
    );

    for (const g of sortedGlobals) {
      const conds = resolve(g.conds);
      const atRules = conds.filter((c) => c.atRule);
      const indent = "  ".repeat(atRules.length);

      for (const c of atRules) {
        out.push(`${c.atRule} {`);
      }

      const sel = selectorFor(g.selector, g.template, conds);
      out.push(`${indent}${sel} {`, g.origin);

      for (const d of g.declarations) {
        out.push(`${indent}  ${d.prop}: ${d.value};`);
      }

      out.push([`${indent}}`, ...atRules.map(() => "}")].join("\n"));
    }

    close();
  }

  const groups = new Map<string, Atom[]>();

  for (const atom of input.atoms) {
    const k = atom.conds.join("+");
    let g = groups.get(k);

    if (!g) {
      groups.set(k, (g = []));
    }

    g.push(atom);
  }

  const orderedGroups = [...groups.entries()].toSorted(([a], [b]) => {
    const ra = a ? groupRank(a.split("+")) : "";
    const rb = b ? groupRank(b.split("+")) : "";

    return compare(ra, rb);
  });

  open("atoms");

  for (const [key, atoms] of orderedGroups) {
    const conds = resolve(key ? key.split("+") : []);
    const atRules = conds.filter((c) => c.atRule);
    const indent = "  ".repeat(atRules.length);

    const sorted = atoms.toSorted((a, b) => {
      // Resting before pseudo, shorthands before longhands, then stable by name.
      const s = (a.selector ? 1 : 0) - (b.selector ? 1 : 0);

      if (s) {
        return s;
      }

      const r = propRank(a.prop) - propRank(b.prop);

      if (r) {
        return r;
      }

      return compare(a.className, b.className);
    });

    for (const c of atRules) {
      out.push(`${c.atRule} {`);
    }

    for (const a of sorted) {
      const sel = selectorFor(
        `.${escapeClass(a.className)}`,
        a.selector,
        conds
      );

      out.push(`${indent}${sel} { ${a.prop}: ${a.value}; }`, a.origin);
    }

    out.push(atRules.map(() => "}").join("\n"));
  }

  close();

  return { css: out.toString(), origins: out.origins };
}
