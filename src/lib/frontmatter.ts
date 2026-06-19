// YAML frontmatter parsing on Bun's built-in YAML (`Bun.YAML`, since Bun 1.2.21)
// — no `yaml` dependency. The strict path surfaces the line/col carried on the
// thrown SyntaxError so skill/knowledge lint errors stay actionable. (Bun.YAML
// throws on the first error rather than collecting every error like the `yaml`
// Document API did; for small frontmatter blocks one error at a time is fine.)

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function extractFrontmatterBlock(md: string): string | null {
  const m = FRONTMATTER_RE.exec(md);
  return m ? (m[1] ?? "") : null;
}

export function parseFrontmatter(md: string): unknown {
  const block = extractFrontmatterBlock(md);
  if (block === null) return null;
  try {
    return Bun.YAML.parse(block);
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
  data: unknown; // null if no frontmatter or a parse error
  errors: FrontmatterParseError[];
}

/**
 * Parse YAML frontmatter and report a structured error (line/col) when
 * available. Use this when you want to surface actionable error info to a
 * skill/agent author. For loose use (just want the parsed object or null),
 * `parseFrontmatter` is still fine.
 */
export function parseFrontmatterStrict(md: string): FrontmatterParseResult {
  const block = extractFrontmatterBlock(md);
  if (block === null) return { data: null, errors: [] };
  try {
    return { data: Bun.YAML.parse(block), errors: [] };
  } catch (e) {
    // Bun.YAML's SyntaxError carries no reliable block-relative position
    // (line/column map to the JS call site; originalLine/Column aren't
    // block-relative either), so report the message only. Frontmatter blocks
    // are a handful of lines — the message alone is actionable.
    const message = e instanceof Error ? e.message : "YAML parse error";
    return { data: null, errors: [{ message }] };
  }
}
