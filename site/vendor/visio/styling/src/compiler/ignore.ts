import { child, children, text } from "./ast.ts";
import type { AstNode } from "./ast.ts";
import type { Diagnostic } from "./errors.ts";
import { error } from "./errors.ts";
import type { SourceSpan } from "./model.ts";

/** Warnings and report findings a directive may name. */
const IGNORABLE = new Set([
  "EDGE_SET_TWICE",
  "WILL_CHANGE_STATIC",
  "CONTENT_VISIBILITY_NEEDS_SIZE",
  "OVERFLOW_HIDDEN",
  "CLASSES_OVERLAP",
  "ATOM_HANDWRITTEN",
  "RESPONSIVE_NEEDS_SIZES",
  "VALUE_NEAR_DUPLICATE",
  "COLOR_MATCHES_TOKEN",
  "COLOR_NEAR_TOKEN",
  "TOKEN_UNUSED",
  "TARGET_TOO_SMALL",
]);

export interface IgnoreDirective {
  /** Relative to the project root. */
  file: string;
  codes: string[];
  reason: string;
  /** Byte offsets of the comment. */
  start: number;
  end: number;
  /** 1-based line the directive covers: the key after it, or its own line. */
  line: number;
  /** Dotted path of the key on that line, when one was recorded. */
  path?: string;
  /** Set once a warning or finding matched. */
  used: boolean;
}

export interface Comment {
  value: string;
  start: number;
  end: number;
}

const DIRECTIVE =
  /^\s*visio-ignore\b\s*(?<codes>[A-Z_][A-Z0-9_]*(?:\s*,\s*[A-Z_][A-Z0-9_]*)*)?\s*(?::\s*(?<reason>[\s\S]*?))?\s*$/v;

export function lineStartsOf(code: string): number[] {
  const starts = [0];

  for (const m of code.matchAll(/\n/gv)) {
    starts.push(m.index + 1);
  }

  return starts;
}

function startAt(lineStarts: number[], index: number): number {
  const start = lineStarts[index];

  if (start === undefined) {
    throw new Error(
      `[@visio/styling] Line ${index + 1} is past the end of the file.`
    );
  }

  return start;
}

/** Zero-based line and column of a byte offset. */
export function lineColumn(
  lineStarts: number[],
  offset: number
): [number, number] {
  let lo = 0;
  let hi = lineStarts.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);

    if (startAt(lineStarts, mid) <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return [lo, offset - startAt(lineStarts, lo)];
}

export function lineOf(lineStarts: number[], offset: number): number {
  return lineColumn(lineStarts, offset)[0] + 1;
}

/** Whether only whitespace sits between the start of the line and `offset`. */
function firstOnLine(
  code: string,
  lineStarts: number[],
  offset: number
): boolean {
  const start = startAt(lineStarts, lineOf(lineStarts, offset) - 1);

  return code.slice(start, offset).trim() === "";
}

/** The next line after `line` that has something other than whitespace on it. */
function nextContentLine(
  code: string,
  lineStarts: number[],
  line: number
): number {
  for (let l = line + 1; l <= lineStarts.length; l += 1) {
    const from = startAt(lineStarts, l - 1);
    const to = lineStarts[l] ?? code.length;

    if (code.slice(from, to).trim() !== "") {
      return l;
    }
  }

  return line;
}

export interface DirectiveScan {
  directives: IgnoreDirective[];
  diagnostics: Diagnostic[];
}

/**
 * Reads every directive in a file and attaches the key it covers. `spans`
 * are the recorded key spans by dotted path; the outermost key that starts
 * on the covered line is the one, since a prefix covers what is nested.
 */
export function collectDirectives(
  file: string,
  code: string,
  comments: Comment[],
  spans: Iterable<[string, SourceSpan]>
): DirectiveScan {
  const directives: IgnoreDirective[] = [];
  const diagnostics: Diagnostic[] = [];
  const lineStarts = lineStartsOf(code);
  const keysByLine = new Map<number, string>();

  for (const [path, span] of spans) {
    const line = lineOf(lineStarts, span.start);
    const current = keysByLine.get(line);

    if (current === undefined || path.length < current.length) {
      keysByLine.set(line, path);
    }
  }

  for (const c of comments) {
    if (!/^\s*visio-ignore\b/v.test(c.value)) {
      continue;
    }

    const m = DIRECTIVE.exec(c.value);
    const commentLine = lineOf(lineStarts, c.start);
    const at = { file, start: c.start, end: c.end, line: commentLine };
    const listed = m?.groups?.codes;
    const codes = listed ? listed.split(",").map((s) => s.trim()) : [];
    const reason = m?.groups?.reason?.trim() ?? "";

    if (!m || codes.length === 0) {
      diagnostics.push(
        error(
          "IGNORE_NEEDS_CODE",
          `A visio-ignore directive names the finding it silences: \`// visio-ignore VALUE_NEAR_DUPLICATE: why\`.`,
          at
        )
      );
      continue;
    }

    const bad = codes.filter((name) => !IGNORABLE.has(name));

    if (bad.length) {
      diagnostics.push(
        error(
          "IGNORE_NOT_ALLOWED",
          `\`${bad.join(", ")}\` cannot be ignored. Only warnings and report findings can: ${[...IGNORABLE].join(", ")}. An error rejects a declaration; \`unsafe\` emits one as written.`,
          at
        )
      );
      continue;
    }

    if (!reason) {
      diagnostics.push(
        error(
          "IGNORE_NEEDS_REASON",
          `A visio-ignore directive carries a reason after the colon: \`// visio-ignore ${codes.join(", ")}: why this is deliberate\`.`,
          at
        )
      );
      continue;
    }

    const line = firstOnLine(code, lineStarts, c.start)
      ? nextContentLine(code, lineStarts, lineOf(lineStarts, c.end))
      : commentLine;

    directives.push({
      file,
      codes,
      reason,
      start: c.start,
      end: c.end,
      line,
      path: keysByLine.get(line),
      used: false,
    });
  }

  return { directives, diagnostics };
}

export interface IgnoreTarget {
  code: string;
  path?: string;
  /** 1-based line, for a target without a path. */
  line?: number;
}

/** Whether a directive covers a warning or finding location in the same file. */
export function covers(d: IgnoreDirective, target: IgnoreTarget): boolean {
  if (!d.codes.includes(target.code)) {
    return false;
  }

  if (d.path !== undefined && target.path !== undefined) {
    return target.path === d.path || target.path.startsWith(`${d.path}.`);
  }

  return target.line !== undefined && target.line === d.line;
}

/**
 * Drops the warnings a file's directives cover and marks those directives
 * used. Errors pass through untouched.
 */
export function applyIgnores(
  diagnostics: Diagnostic[],
  directives: IgnoreDirective[],
  lineStarts: number[]
): Diagnostic[] {
  if (directives.length === 0) {
    return diagnostics;
  }

  return diagnostics.filter((diag) => {
    if (diag.severity !== "warning") {
      return true;
    }

    const line =
      diag.line ??
      (diag.start === undefined ? undefined : lineOf(lineStarts, diag.start));

    const hit = directives.find((d) =>
      covers(d, { code: diag.code, path: diag.path, line })
    );

    if (hit) {
      hit.used = true;
    }

    return !hit;
  });
}

function staticKey(key: AstNode): string | null {
  if (key.type === "Identifier") {
    return text(key, "name");
  }

  return key.type === "Literal" ? String(key.value) : null;
}

/** Records the span of every key in an object literal by dotted path, nested objects included. */
export function objectKeySpans(
  node: AstNode,
  path: string,
  out: Map<string, SourceSpan>
) {
  if (node.type !== "ObjectExpression") {
    return;
  }

  for (const prop of children(node, "properties")) {
    if (prop.type !== "Property") {
      continue;
    }

    const name = staticKey(child(prop, "key"));

    if (name === null) {
      continue;
    }

    const full = path ? `${path}.${name}` : name;
    out.set(full, { start: prop.start, end: prop.end });
    objectKeySpans(child(prop, "value"), full, out);
  }
}
