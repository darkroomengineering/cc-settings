import { parse as parseYaml } from "yaml";

export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

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
