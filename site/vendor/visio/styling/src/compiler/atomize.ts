import { group } from "./match.ts";
import type { Atom, Declaration } from "./model.ts";
import { ABBREVIATIONS } from "./props.ts";
import { replaceAmp, splitList } from "./selector.ts";

export function hash(input: string, length = 5): string {
  // FNV-1a, base36. Deterministic across runs and platforms.
  let h = 0x81_1c_9d_c5;

  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }

  return h.toString(36).slice(0, length);
}

const FLUID_RE = /^calc\((?<n>-?[\d.]+) \* var\(--dp\)\)$/v;
const FLUID_H_RE = /^calc\((?<n>-?[\d.]+) \* var\(--dph\)\)$/v;
const COL_RE = /^calc\((?<n>\d+) \* var\(--col\) \+ \d+ \* var\(--gap\)\)$/v;
const VAR_RE = /^var\(--(?<name>[a-z0-9\-]+)\)$/iv;
const HEX_RE = /^#(?<hex>[0-9a-f]{3,8})$/iv;
const NUM_UNIT_RE = /^(?<n>-?[\d.]+)(?<unit>[a-z%]*)$/iv;

function valueSlug(value: string): string {
  let m: RegExpMatchArray | null;

  if (value === "var(--col)") {
    return "col1";
  }

  if ((m = value.match(FLUID_RE))) {
    return `dp${group(m, "n").replace("-", "n").replace(".", "_")}`;
  }

  if ((m = value.match(FLUID_H_RE))) {
    return `dph${group(m, "n").replace("-", "n").replace(".", "_")}`;
  }

  if ((m = value.match(COL_RE))) {
    return `col${group(m, "n")}`;
  }

  if ((m = value.match(VAR_RE))) {
    return group(m, "name").replace(/^(?:colors|sizes|easings|fonts)-/v, "");
  }

  if ((m = value.match(HEX_RE))) {
    return group(m, "hex").toLowerCase();
  }

  if ((m = value.match(NUM_UNIT_RE))) {
    return `${group(m, "n").replace("-", "n").replace(".", "_")}${group(m, "unit")}`;
  }

  const cleaned = value
    .toLowerCase()
    .replaceAll(/var\(--(?<name>[a-z0-9\-]+)\)/gv, "$<name>")
    .replaceAll(/[^a-z0-9]+/gv, "-")
    .replaceAll(/^-|-$/gv, "");

  if (cleaned.length > 0 && cleaned.length <= 24) {
    return cleaned;
  }

  return `x${hash(value)}`;
}

/** `&:active` -> `active`, `& > *` -> `child-any`, `.parent:active &` -> `parent-active-in`, lists join with `or`. */
function selectorSlug(selector: string): string {
  if (!selector) {
    return "";
  }

  return splitList(selector).map(slugOne).join("-or-");
}

function slugOne(selector: string): string {
  return replaceAmp(selector.replace(/^&/v, ""), " in ")
    .replaceAll(">", " child ")
    .replaceAll("+", " next ")
    .replaceAll("~", " sib ")
    .replaceAll("*", " any ")
    .replaceAll(/[^a-z0-9\-]+/giv, "-")
    .replaceAll(/^-|-$/gv, "")
    .toLowerCase();
}

function atomKey(
  d: Pick<Declaration, "prop" | "value" | "conds" | "selector" | "unsafe">
): string {
  return `${d.unsafe ? "unsafe|" : ""}${d.conds.join("+")}|${d.selector}|${d.prop}|${d.value}`;
}

/** Property identity for merge semantics: same prop in the same context. */
export function propKey(
  d: Pick<Declaration, "prop" | "conds" | "selector">
): string {
  return `${d.conds.join("+")}|${d.selector}|${d.prop}`;
}

export function propOf(key: string): string {
  return key.slice(key.lastIndexOf("|") + 1);
}

export class AtomRegistry {
  private atoms = new Map<string, Atom>();
  /** className -> key */
  private names = new Map<string, string>();
  /** file -> keys */
  private owners = new Map<string, Set<string>>();
  /** key -> number of files that own it */
  private refs = new Map<string, number>();
  private dirty = true;

  get size() {
    return this.atoms.size;
  }

  get changed() {
    return this.dirty;
  }

  markClean() {
    this.dirty = false;
  }

  /** Registers a declaration for a file and returns its class name. */
  add(file: string, d: Declaration): Atom {
    const key = atomKey(d);
    let atom = this.atoms.get(key);

    if (!atom) {
      atom = {
        key,
        className: this.nameFor(key, d),
        prop: d.prop,
        value: d.value,
        conds: d.conds,
        selector: d.selector,
        origin: d.loc ? { file, offset: d.loc.start } : undefined,
      };
      this.atoms.set(key, atom);
      this.names.set(atom.className, key);
      this.dirty = true;
    }

    let owned = this.owners.get(file);

    if (!owned) {
      this.owners.set(file, (owned = new Set()));
    }

    if (!owned.has(key)) {
      owned.add(key);
      this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    }

    return atom;
  }

  /** Forgets a file's atoms before it is re-registered. Atoms no other file uses are dropped. */
  release(file: string) {
    const owned = this.owners.get(file);

    if (!owned) {
      return;
    }

    this.owners.delete(file);

    for (const key of owned) {
      const left = (this.refs.get(key) ?? 1) - 1;

      if (left > 0) {
        this.refs.set(key, left);
        continue;
      }

      this.refs.delete(key);
      const atom = this.atoms.get(key);

      if (atom) {
        this.names.delete(atom.className);
      }

      this.atoms.delete(key);
      this.dirty = true;
    }
  }

  all(): Atom[] {
    return [...this.atoms.values()];
  }

  /** The atom behind a class name, if the name is one the compiler generated. */
  get(className: string): Atom | undefined {
    const key = this.names.get(className);

    return key === undefined ? undefined : this.atoms.get(key);
  }

  private nameFor(key: string, d: Declaration): string {
    const prop = ABBREVIATIONS.get(d.prop) ?? d.prop;

    const parts = [
      ...(d.unsafe ? ["unsafe"] : []),
      ...d.conds,
      selectorSlug(d.selector),
      prop,
      valueSlug(d.value),
    ].filter(Boolean);

    let name = parts.join("-");
    const taken = this.names.get(name);

    if (taken && taken !== key) {
      name = `${name}-${hash(key, 4)}`;
    }

    return name;
  }
}
