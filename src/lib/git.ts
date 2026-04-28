// Tiny git CLI wrappers. Keep it minimal — scripts that need stderr or exit
// codes (statusLine, upstream/scan) roll their own to avoid bloating this lib
// with cases the common path doesn't need.

/** Run `git <args>` and return trimmed stdout. Failures yield "" rather than throwing. */
export async function runGit(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}
