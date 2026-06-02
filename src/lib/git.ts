// Tiny process/git wrappers.
//   runGit         — trimmed git stdout only, swallows errors. Common path.
//   runProcessFull — full {exit, stdout, stderr} for any binary. Callers that
//                    need the exit code or stderr use runProcessFull("git", …).

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
