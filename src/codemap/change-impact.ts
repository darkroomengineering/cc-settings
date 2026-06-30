// Change impact: from the git working-tree diff to the blast radius. Maps each
// changed TS/JS file to its exported symbols, then unions the files that import
// those files with the files that reference those symbols. Reuses runGit (the
// same wrapper the rest of cc-settings uses) and the codemap query primitives.

import { runGit } from "../lib/git.ts";
import { getImpact } from "./callgraph.ts";
import { getImporters } from "./imports.ts";
import { getContext } from "./program.ts";
import { resolveFile } from "./structure.ts";
import type { ChangeImpactResult, SymbolInfo } from "./types.ts";

const SOURCE_RE = /\.(ts|tsx|js|jsx|mts|cts)$/;

export async function getChangeImpact(projectDir: string): Promise<ChangeImpactResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;

  // Unstaged + staged changes, relative to the repo root.
  const [unstaged, staged] = await Promise.all([
    runGit(["diff", "--name-only", "HEAD"], { cwd: projectDir }),
    runGit(["diff", "--cached", "--name-only"], { cwd: projectDir }),
  ]);
  const names = new Set(
    [...unstaged.split("\n"), ...staged.split("\n")].map((s) => s.trim()).filter(Boolean),
  );
  const changedFiles = [...names].filter((f) => SOURCE_RE.test(f)).sort();

  const changedSymbols: SymbolInfo[] = [];
  const affected = new Set<string>();

  for (const rel of changedFiles) {
    const structure = await resolveFile(projectDir, rel);
    if (structure) {
      for (const s of structure.symbols) if (s.exported) changedSymbols.push(s);
    }
    const importers = await getImporters(projectDir, rel);
    if (importers) for (const i of importers.importers) affected.add(i);
  }

  for (const s of changedSymbols) {
    const impact = await getImpact(projectDir, s.name);
    if (impact) for (const r of impact.references) affected.add(r.file);
  }

  return { changedFiles, changedSymbols, affected: [...affected].sort() };
}
