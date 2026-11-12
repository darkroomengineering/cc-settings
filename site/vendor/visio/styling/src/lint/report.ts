import { covers } from "../compiler/ignore.ts";
import type { IgnoreDirective } from "../compiler/ignore.ts";
import type { Declaration } from "../compiler/model.ts";
import { tokenVarName } from "../helpers.ts";
import type { Tokens } from "../tokens/index.ts";
import { a11yFindings } from "./a11y.ts";
import type { LocatedComposition } from "./a11y.ts";
import { parseValues } from "./values.ts";
import type { ParsedValue } from "./values.ts";

const FINDING_CODES = [
  "VALUE_NEAR_DUPLICATE",
  "COLOR_MATCHES_TOKEN",
  "COLOR_NEAR_TOKEN",
  "TOKEN_UNUSED",
  "CLASSES_OVERLAP",
  "EDGE_SET_TWICE",
  "WILL_CHANGE_STATIC",
  "CONTENT_VISIBILITY_NEEDS_SIZE",
  "OVERFLOW_HIDDEN",
  "ATOM_HANDWRITTEN",
  "RESPONSIVE_NEEDS_SIZES",
  "TARGET_TOO_SMALL",
  "IGNORE_UNUSED",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

const FINDING_CODE_SET = new Set<string>(FINDING_CODES);

export function isFindingCode(code: string): code is FindingCode {
  return FINDING_CODE_SET.has(code);
}

export interface Finding {
  code: FindingCode;
  message: string;
  locations: { file: string; path: string }[];
}

/** A declaration written under `unsafe`, emitted as authored. */
export interface UnsafeDeclaration {
  file: string;
  path: string;
  prop: string;
  value: string;
}

export interface Report {
  generatedAt: string;
  atoms: number;
  files: number;
  findings: Finding[];
  /** Everything that left the compiler as written. Not findings, but on the record. */
  unsafe: UnsafeDeclaration[];
  /** Variables declared in the tokens but left out of the stylesheet. */
  pruned: string[];
}

export interface Located extends Declaration {
  file: string;
}

export interface ReportOptions {
  /** Design px within which two values count as a near miss. Default 2. */
  tolerance?: number;
  /** Variable names referenced anywhere in the project. */
  used?: Set<string>;
  pruned?: string[];
  /** The compiler's warnings, as findings. */
  extra?: Finding[];
  /** The tokens module relative to the root, so preset findings can point at it. */
  tokensFile?: string;
  /** How styled JSX elements compose their blocks, for the pointer-target check. */
  compositions?: LocatedComposition[];
  /** `visio-ignore` directives from every file. Findings they cover are dropped; ones that match nothing are reported. */
  ignores?: IgnoreDirective[];
}

/** Groups properties that share a scale so 15 vs 16 is caught across padding-top and padding-left. */
function family(prop: string): string {
  if (
    /^(?:padding|margin|inset|top|right|bottom|left|row-gap|column-gap)/v.test(
      prop
    )
  ) {
    return "spacing";
  }

  if (/^(?:width|height|min-|max-|inline-size|block-size)/v.test(prop)) {
    return "size";
  }

  if (prop.endsWith("radius")) {
    return "radius";
  }

  if (
    prop === "font-size" ||
    prop === "line-height" ||
    prop === "letter-spacing"
  ) {
    return "type";
  }

  return prop;
}

/** A shorthand expands to several longhands with one path; report it once. */
function uniqueLocations(decls: Located[]): { file: string; path: string }[] {
  const seen = new Set<string>();

  return decls.flatMap((d) => {
    const k = `${d.file}:${d.path}`;

    if (seen.has(k)) {
      return [];
    }

    seen.add(k);

    return [{ file: d.file, path: d.path }];
  });
}

type Rgb = [number, number, number];

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function nearDuplicates(
  all: Located[],
  parsedPx: (number | undefined)[],
  tolerance: number
): Finding[] {
  const findings: Finding[] = [];
  const byFamily = new Map<string, Map<number, Located[]>>();

  for (const [i, d] of all.entries()) {
    // Preset values are deliberate per-screen pairs, not near misses.
    if (d.fromPreset) {
      continue;
    }

    const n = d.meta ? d.meta.n : parsedPx[i];
    const kind = d.meta ? d.meta.kind : "px";

    if (n === undefined || n === 0) {
      continue;
    }

    // Column counts are a coarse scale; columns(3) next to columns(4) is a choice, not a miss.
    if (kind === "col") {
      continue;
    }

    const fam = `${family(d.prop)}:${kind}`;
    let m = byFamily.get(fam);

    if (!m) {
      byFamily.set(fam, (m = new Map()));
    }

    let list = m.get(n);

    if (!list) {
      m.set(n, (list = []));
    }

    list.push(d);
  }

  for (const [fam, values] of byFamily) {
    const sorted = [...values].toSorted(([a], [b]) => a - b);

    for (const [i, [a, ca]] of sorted.entries()) {
      const next = sorted[i + 1];

      if (!next) {
        continue;
      }

      const [b, cb] = next;

      if (b - a > tolerance) {
        continue;
      }

      const [rare, common, rareDecls] =
        ca.length <= cb.length ? [a, b, ca] : [b, a, cb];

      findings.push({
        code: "VALUE_NEAR_DUPLICATE",
        message: `${fam.split(":")[0]} uses both ${a} and ${b} (${ca.length} and ${cb.length} times). If that is not deliberate, unify on ${common}, or make ${rare} a token.`,
        locations: uniqueLocations(rareDecls),
      });
    }
  }

  return findings;
}

/** An opaque colour's channels; a translucent one mixes with what is behind it and matches nothing. */
function opaque(p: ParsedValue): Rgb | undefined {
  return p.alpha === 1 ? p.rgb : undefined;
}

function colourFindings(
  all: Located[],
  parsed: ParsedValue[],
  tokens: Tokens
): Finding[] {
  const findings: Finding[] = [];
  const entries = Object.entries(tokens.source.colors);

  const tokenRgb = parseValues(
    entries.map(([, v]) => ({ prop: "color", value: v }))
  ).map(opaque);

  for (const [i, d] of all.entries()) {
    const value = parsed[i];

    if (!value) {
      throw new Error(
        `[@visio/styling] parseValues() returned no result for \`${d.path}\`.`
      );
    }

    const rgb = opaque(value);

    if (!rgb || d.value.includes("var(")) {
      continue;
    }

    let best: { name: string; dist: number } | undefined;

    for (const [j, [name]] of entries.entries()) {
      const t = tokenRgb[j];

      if (!t) {
        continue;
      }

      const dist = distance(rgb, t);

      if (!best || dist < best.dist) {
        best = { name, dist };
      }
    }

    if (!best) {
      continue;
    }

    if (best.dist === 0) {
      findings.push({
        code: "COLOR_MATCHES_TOKEN",
        message: `\`${d.value}\` is the colour token \`${best.name}\`. Use t.colors.${best.name}.`,
        locations: [{ file: d.file, path: d.path }],
      });
    } else if (best.dist < 24) {
      findings.push({
        code: "COLOR_NEAR_TOKEN",
        message: `\`${d.value}\` is close to the colour token \`${best.name}\` (${tokens.source.colors[best.name]}). Use the token, or add a new one if the difference is deliberate.`,
        locations: [{ file: d.file, path: d.path }],
      });
    }
  }

  return findings;
}

function unusedTokens(
  tokens: Tokens,
  used: Set<string>,
  tokensFile?: string
): Finding[] {
  const groups = ["colors", "sizes", "easings", "fonts"] as const;
  const findings: Finding[] = [];

  for (const g of groups) {
    for (const k of Object.keys(tokens.source[g] ?? {})) {
      const name = tokenVarName(g, k);

      if (used.has(name)) {
        continue;
      }

      findings.push({
        code: "TOKEN_UNUSED",
        message: `Token \`${g}.${k}\` is never used, so \`${name}\` is not in the stylesheet. Use it, remove it, or put \`// visio-ignore TOKEN_UNUSED: reason\` above it or its group.`,
        locations: tokensFile ? [{ file: tokensFile, path: `${g}.${k}` }] : [],
      });
    }
  }

  return findings;
}

/**
 * Drops the locations directives cover. A finding whose every location was
 * covered goes; one with locations left keeps those. A directive that
 * covered nothing here and no warning at compile time becomes a finding.
 */
function applyDirectives(
  findings: Finding[],
  ignores: IgnoreDirective[]
): Finding[] {
  if (ignores.length === 0) {
    return findings;
  }

  const matched = new Set<IgnoreDirective>();

  const kept = findings.flatMap((f) => {
    const locations = f.locations.filter((l) => {
      const hit = ignores.find(
        (d) => d.file === l.file && covers(d, { code: f.code, path: l.path })
      );

      if (hit) {
        matched.add(hit);
      }

      return !hit;
    });

    if (f.locations.length > 0 && locations.length === 0) {
      return [];
    }

    return [{ ...f, locations }];
  });

  for (const d of ignores) {
    if (d.used || matched.has(d)) {
      continue;
    }

    kept.push({
      code: "IGNORE_UNUSED",
      message: `\`visio-ignore ${d.codes.join(", ")}\` ("${d.reason}") matches nothing. The finding is gone, so remove the directive.`,
      locations: [{ file: d.file, path: d.path ?? `line ${d.line}` }],
    });
  }

  return kept;
}

export function buildReport(
  all: Located[],
  tokens: Tokens | null,
  atoms: number,
  opts: ReportOptions = {}
): Report {
  const unsafe = all.filter((d) => d.unsafe);
  const linted = all.filter((d) => !d.unsafe);
  const parsed = parseValues(linted);

  let findings: Finding[] = [
    ...(opts.extra ?? []),
    ...nearDuplicates(
      linted,
      parsed.map((p) => p.px),
      opts.tolerance ?? 2
    ),
  ];

  if (tokens) {
    findings.push(
      ...colourFindings(linted, parsed, tokens),
      ...unusedTokens(
        tokens,
        opts.used ?? usedVarsFromDeclarations(all),
        opts.tokensFile
      ),
      ...a11yFindings(linted, { tokens, compositions: opts.compositions })
    );
  }

  findings = applyDirectives(findings, opts.ignores ?? []);

  return {
    generatedAt: new Date().toISOString(),
    atoms,
    files: new Set(all.map((d) => d.file)).size,
    findings,
    unsafe: unsafe.map((d) => ({
      file: d.file,
      path: d.path,
      prop: d.prop,
      value: d.value,
    })),
    pruned: opts.pruned ?? [],
  };
}

/** Variable references found inside declaration values. */
export function usedVarsFromDeclarations(
  all: Pick<Declaration, "value">[]
): Set<string> {
  const used = new Set<string>();

  for (const d of all) {
    const refs = d.value.match(/var\(--[a-z0-9\-]+\)/giv) ?? [];

    for (const r of refs) {
      used.add(r.slice(4, -1));
    }
  }

  return used;
}

/** `1 finding`, `2 findings`. */
function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Each finding with up to four of its locations, one per line, indented. */
function findingLines(findings: Finding[]): string {
  const lines: string[] = [];

  for (const f of findings) {
    lines.push(`  ${f.code}: ${f.message}`);

    for (const l of f.locations.slice(0, 4)) {
      lines.push(`      ${l.file} › ${l.path}`);
    }

    if (f.locations.length > 4) {
      lines.push(`      … ${f.locations.length - 4} more`);
    }
  }

  return lines.join("\n");
}

/** What findings do to a build, for the line that counts them. */
export function buildVerdict(strictReport: boolean): string {
  return strictReport
    ? "each fails the build"
    : "the build does not fail on them";
}

/** The findings alone, under a line that counts them and says what they fail. */
export function formatFindings(findings: Finding[], verdict: string): string {
  return `${count(findings.length, "finding")}; ${verdict}\n${findingLines(findings)}`;
}

/** The report for a terminal. `verdict` says what the findings fail, after their count. */
export function formatReport(report: Report, verdict?: string): string {
  const head = `styling: ${count(report.atoms, "atom")} across ${count(report.files, "file")}`;

  const pruned = report.pruned.length
    ? `, ${count(report.pruned.length, "unused variable")} pruned (${report.pruned.join(", ")})`
    : "";

  const unsafe = report.unsafe.length
    ? `, ${count(report.unsafe.length, "declaration")} emitted as written`
    : "";

  if (!report.findings.length && !report.unsafe.length) {
    return `${head}${pruned}, nothing to report.`;
  }

  const tail = report.findings.length
    ? `${count(report.findings.length, "finding")}${verdict ? `; ${verdict}` : ""}`
    : "no findings";

  const lines = [`${head}${pruned}${unsafe}, ${tail}`];

  if (report.findings.length) {
    lines.push(findingLines(report.findings));
  }

  for (const u of report.unsafe) {
    lines.push(`  unsafe: ${u.file} › ${u.path} (${u.prop}: ${u.value})`);
  }

  return lines.join("\n");
}
