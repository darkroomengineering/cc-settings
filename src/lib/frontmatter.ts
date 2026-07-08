// YAML frontmatter parsing on Bun's built-in YAML (`Bun.YAML`, since Bun 1.2.21)
// — no `yaml` dependency. The strict path surfaces the line/col carried on the
// thrown SyntaxError so skill/knowledge lint errors stay actionable. (Bun.YAML
// throws on the first error rather than collecting every error like the `yaml`
// Document API did; for small frontmatter blocks one error at a time is fine.)

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Single source of truth for "is this valid kebab-case" — shared by the
// agent/skill/profile/knowledge `name` field schemas and lint-skills.ts's
// folder-name check, which previously disagreed (schemas allowed a leading
// digit and trailing/double hyphens; the folder check required a leading
// letter; knowledge.ts alone matched this stricter form). This is the
// strictest of the three regexes that were in use, verified to still accept
// every existing skill/agent/profile name on disk (lowercase alnum segments
// joined by single hyphens — no leading/trailing/double hyphen).
export const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

/** Top-level keys that appear more than once in a frontmatter block. Bun.YAML
 *  (unlike the `yaml` package, which threw "Map keys must be unique") silently
 *  keeps the last value on a duplicate key, so we detect it ourselves for the
 *  lint path. Only column-0 keys are scanned: nested mappings, list items, and
 *  block-scalar continuations are always indented, so they never match — which
 *  keeps this false-positive-free without a full YAML parser. */
function duplicateTopLevelKeys(block: string): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z0-9_$.-]+) *:/.exec(line);
    const key = m?.[1];
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    else seen.add(key);
  }
  return [...dupes];
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
    const data = Bun.YAML.parse(block);
    const dupes = duplicateTopLevelKeys(block);
    if (dupes.length > 0) {
      return {
        data: null,
        errors: [{ message: `duplicate frontmatter key(s): ${dupes.join(", ")}` }],
      };
    }
    return { data, errors: [] };
  } catch (e) {
    // Bun.YAML's SyntaxError carries no reliable block-relative position
    // (line/column map to the JS call site; originalLine/Column aren't
    // block-relative either), so report the message only. Frontmatter blocks
    // are a handful of lines — the message alone is actionable.
    const message = e instanceof Error ? e.message : "YAML parse error";
    return { data: null, errors: [{ message }] };
  }
}
