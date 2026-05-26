// Tiny git CLI wrappers.
//   runGit      — trimmed stdout only, swallows errors. Common path.
//   runGitFull  — full {exit, stdout, stderr} shape. For scripts that need
//                 to inspect failures or stderr.

/**
 * Run `git <args>` and return trimmed stdout. Failures yield "" rather than
 * throwing. Pass `{ cwd }` to run against another working tree (`git -C <cwd>`).
 */
export async function runGit(args: string[], options?: { cwd?: string }): Promise<string> {
  const prefix = options?.cwd ? ["-C", options.cwd] : [];
  const proc = Bun.spawn(["git", ...prefix, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

/**
 * Run an arbitrary command, returning the full {exit, stdout, stderr} shape.
 * Stdout/stderr are NOT trimmed (trim at the call site if needed).
 */
export async function runProcessFull(
  bin: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
}

/**
 * Like `runGit` but returns the full result shape. Use when you need the
 * exit code, stderr, or both.
 */
export function runGitFull(
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  return runProcessFull("git", args);
}
