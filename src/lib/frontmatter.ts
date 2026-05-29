import { parseDocument, parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function extractFrontmatterBlock(md: string): string | null {
  const m = FRONTMATTER_RE.exec(md);
  return m ? (m[1] ?? "") : null;
}

export function parseFrontmatter(md: string): unknown {
  const block = extractFrontmatterBlock(md);
  if (block === null) return null;
  try {
    return parseYaml(block);
  } catch {
    return null;
  }
}

interface FrontmatterParseError {
  message: string;
  code?: string;
  line?: number;
  col?: number;
}

interface FrontmatterParseResult {
  data: unknown; // null if no frontmatter or all-error
  errors: FrontmatterParseError[];
}

/**
 * Parse YAML frontmatter and report structured errors (line/col/code) when
 * available. Use this when you want to surface actionable error info to a
 * skill/agent author. For loose use (just want the parsed object or null),
 * `parseFrontmatter` is still fine.
 */
export function parseFrontmatterStrict(md: string): FrontmatterParseResult {
  const block = extractFrontmatterBlock(md);
  if (block === null) return { data: null, errors: [] };
  const doc = parseDocument(block);
  const errors: FrontmatterParseError[] = doc.errors.map((e) => ({
    message: e.message,
    code: e.code,
    line: e.linePos?.[0]?.line,
    col: e.linePos?.[0]?.col,
  }));
  return { data: doc.errors.length ? null : doc.toJS(), errors };
}
