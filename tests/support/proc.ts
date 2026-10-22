export interface CaptureResult {
  stdout: string;
  exit: number;
}

/** Spawns `cmd`, merges `env` over the host's `process.env` (dropping keys
 *  explicitly set to `undefined`, e.g. to unset a var), optionally writes
 *  `stdin`, and resolves once the child exits with its captured stdout. */
export async function spawnCapture(
  cmd: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: string;
    stderr?: "pipe" | "ignore" | "inherit";
  } = {},
): Promise<CaptureResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...opts.env })) {
    if (v !== undefined) env[k] = v;
  }
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env,
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: opts.stderr ?? "pipe",
  });
  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}
