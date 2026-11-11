// Bounding a spawned CLI by its timeout: kill the process tree, then stop reading
// its pipes. Shared by the two model bridges (src/lib/codex.ts, src/lib/claude-bridge.ts).

// After the timeout kill, how long a caller waits for the process to exit and its
// pipes to drain. A process the CLI started can outlive the kill and hold the pipes
// open, so the reads are cancelled when this runs out.
export const KILL_DRAIN_GRACE_MS = 500;
const TREE_KILL_TIMEOUT_MS = 1500;

/** True when `pending` settles within `ms`, false when the time runs out first.
 *  The timer is cleared either way, so it never holds the caller's event loop. */
export async function settlesWithin(pending: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = () => true;
  try {
    return await Promise.race([
      pending.then(settled, settled),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a pipe as it arrives, so the text read so far survives cancelling the read. */
export function collectText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  })();
  return {
    done,
    text: () => text,
    cancel: () => {
      reader.cancel().catch(() => {});
    },
  };
}

/** Every live descendant of `root`, parents before children, from one `ps` snapshot.
 *  Empty when `ps` fails, which leaves the caller with a kill of the root alone. */
function descendantPids(root: number): number[] {
  const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: TREE_KILL_TIMEOUT_MS,
  });
  const childrenOf = new Map<number, number[]>();
  for (const line of ps.stdout.toString().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const found = [...(childrenOf.get(root) ?? [])];
  for (const pid of found) found.push(...(childrenOf.get(pid) ?? []));
  return found;
}

/** Kill `proc` and the processes it started. A CLI can run as a child of the
 *  spawned process (the npm launcher, a Windows `.cmd` shim), so a kill of that
 *  process alone leaves the CLI running. Both tree walks need the root alive, so
 *  they run before it is killed. */
export function killProcessTree(proc: { pid: number; kill(signal: NodeJS.Signals): void }): void {
  let descendants: number[] = [];
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
        timeout: TREE_KILL_TIMEOUT_MS,
      });
    } else {
      descendants = descendantPids(proc.pid);
    }
  } catch {
    // The kill of the root below still runs.
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // Already gone: taskkill ended it.
  }
  for (const pid of descendants) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
