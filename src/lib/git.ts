// Tiny process/git wrappers.
//   runGit         — trimmed git stdout only, swallows errors. Common path.
//   runProcessFull — full {exit, stdout, stderr} for any binary. Callers that
//                    need the exit code or stderr use runProcessFull("git", …).

// Git plumbing calls are expected to return in milliseconds. A stale
// index.lock, a credential-manager prompt (blocking on stdin), or a hung
// remote can otherwise stall a caller indefinitely — including
// handoff.ts's `create`, which runs on the synchronous PreCompact hook and
// would freeze compaction itself. Short and generous only because git
// plumbing has no legitimate reason to take longer.
const GIT_TIMEOUT_MS = 15_000;

/**
 * Run `git <args>` and return trimmed stdout. Failures yield "" rather than
 * throwing. Pass `{ cwd }` to run against another working tree (`git -C <cwd>`).
 * Bounded by GIT_TIMEOUT_MS (hard SIGKILL on expiry) so a hung git process
 * can't stall the caller.
 */
export async function runGit(args: string[], options?: { cwd?: string }): Promise<string> {
  const prefix = options?.cwd ? ["-C", options.cwd] : [];
  const proc = Bun.spawn(["git", ...prefix, ...args], {
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

/**
 * Run an arbitrary command, returning the full {exit, stdout, stderr} shape.
 * Stdout/stderr are NOT trimmed (trim at the call site if needed). Bounded
 * by GIT_TIMEOUT_MS (hard SIGKILL on expiry) so a hung process can't stall
 * the caller.
 */
export async function runProcessFull(
  bin: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
}
