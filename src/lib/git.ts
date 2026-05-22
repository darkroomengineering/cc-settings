// Tiny git CLI wrappers.
//   runGit      — trimmed stdout only, swallows errors. Common path.
//   runGitFull  — full {exit, stdout, stderr} shape. For scripts that need
//                 to inspect failures or stderr.

/** Run `git <args>` and return trimmed stdout. Failures yield "" rather than throwing. */
export async function runGit(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

/**
 * Like `runGit` but returns the full result shape. Use when you need the
 * exit code, stderr, or both. Stdout is NOT trimmed (matches the spawn
 * primitives — trim at the call site if needed).
 */
export async function runGitFull(
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
}
