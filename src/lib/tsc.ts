// Shared `bunx tsc --noEmit` runner for the TypeScript hooks.
// post-edit-tsc.ts (filter output to the edited file) and pre-commit-tsc.ts
// (block the commit on errors) both spawn the same process and combine
// stdout+stderr; only the downstream policy differs, and that stays in each
// script.

export interface TscResult {
  /** stdout followed by stderr, untrimmed — callers filter or tail as needed. */
  combined: string;
  exitCode: number;
}

export interface TscOptions {
  /** Working directory for the spawn; defaults to the current process cwd. */
  cwd?: string;
  /** Pass `--pretty` (the pre-commit hook tails human-readable output). */
  pretty?: boolean;
}

/**
 * Run `bunx tsc --noEmit` (optionally `--pretty`) and return the combined
 * output plus exit code. Throws on spawn failure — callers keep their own
 * fail-open policy.
 */
export async function runTsc(options: TscOptions = {}): Promise<TscResult> {
  const argv = ["bunx", "tsc", "--noEmit"];
  if (options.pretty) argv.push("--pretty");
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { combined: stdout + stderr, exitCode };
}
