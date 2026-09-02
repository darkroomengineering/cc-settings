// Exclusive advisory lock for the install's destructive phase.
//
// The scheduled auto-updater (schedule.ts registers a launchd/systemd job that
// runs auto-update.ts, which execs setup.sh on a timer) can fire while a user
// is running setup.sh by hand. Both drive runFullInstall → cleanOldConfig()'s
// rm and the copy phase's cp over ~/.claude concurrently; interleaved, they can
// leave a half-wiped, half-copied install. An O_EXCL lockfile serializes them:
// the second caller aborts cleanly with a clear message instead of racing.
//
// The lock is advisory (both callers cooperate by taking it) and time-bounded:
// a lock older than STALE_MS is assumed to be a crashed install and reclaimed,
// so one hard-killed run can never wedge every future install. Each run stamps
// a unique owner token so release only removes ITS OWN lock — never one a stale
// reclaim handed to another run. This is not a fully OS-backed lock (no flock /
// heartbeat); for the low frequency of the manual-vs-scheduled race that is a
// deliberate trade, not an oversight.

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { claudePath } from "./platform.ts";

const LOCK_PATH = claudePath("tmp", "install.lock");

// Soft staleness: auto-update.ts caps its setup.sh spawn at 300s, so 10 min is
// safely past any non-interactive run. A lock older than this is reclaimable
// ONLY if its owner process is also dead (see lockIsStale) — a paused
// interactive install stays alive and keeps its lock past this window.
const STALE_MS = 10 * 60 * 1000;
// Hard staleness: an absolute upper bound reclaimed regardless of owner
// liveness. Guards the pid-reuse edge (a dead owner's pid recycled by an
// unrelated live process would otherwise pin the lock forever) while still
// tolerating a long interactive pause. An install idle for an hour is abandoned.
const HARD_STALE_MS = 60 * 60 * 1000;

/** Thrown when another install already holds the lock (and it isn't stale). */
export class InstallLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallLockError";
  }
}

interface LockRecord {
  pid: number;
  token: string;
  at: string;
}

/** Read the current lockfile's record, or null if absent/unparsable. */
async function readLockRecord(lockPath: string): Promise<Partial<LockRecord> | null> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockRecord>;
  } catch {
    return null;
  }
}

/** Read the current lockfile's owner token, or null if absent/unparsable. */
async function readLockToken(lockPath: string): Promise<string | null> {
  const parsed = await readLockRecord(lockPath);
  return typeof parsed?.token === "string" ? parsed.token : null;
}

/** Atomic exclusive create stamped with our owner token. Throws EEXIST if the
 *  lockfile already exists. On a write failure, removes the empty lock it just
 *  created so a partial write can't wedge every future install. */
async function createLockExclusive(lockPath: string, token: string): Promise<void> {
  const handle = await open(lockPath, "wx");
  try {
    const record: LockRecord = { pid: process.pid, token, at: new Date().toISOString() };
    await handle.writeFile(JSON.stringify(record));
  } catch (err) {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
    throw err;
  }
  await handle.close();
}

/** Age of the lockfile in ms, or Infinity if it's gone/unreadable (treat an
 *  unreadable lock as maximally stale so it can be reclaimed). */
async function lockAgeMs(lockPath: string): Promise<number> {
  try {
    const st = await stat(lockPath);
    return Date.now() - st.mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Read the owner pid recorded in the lockfile, or null if absent/unparsable. */
async function readLockPid(lockPath: string): Promise<number | null> {
  const parsed = await readLockRecord(lockPath);
  return typeof parsed?.pid === "number" ? parsed.pid : null;
}

/** True if a process with this pid is running on this machine. Signal 0 is a
 *  liveness probe: it delivers nothing but validates the target. EPERM means the
 *  process exists but we can't signal it (still alive); ESRCH means it's gone.
 *  Exported for the staleness tests. */
export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Is the current lock reclaimable? A lock is stale when its owner is gone, not
 * merely when it's old — a paused interactive install can outlive STALE_MS while
 * still holding the lock legitimately. So:
 *   - past the HARD cap → stale regardless of the owner (abandoned; guards pid reuse),
 *   - owner process still alive → NOT stale (keep waiting),
 *   - owner dead/unknown → stale once past the soft window.
 */
async function lockIsStale(lockPath: string): Promise<boolean> {
  const ageMs = await lockAgeMs(lockPath);
  if (ageMs > HARD_STALE_MS) return true;
  const pid = await readLockPid(lockPath);
  if (pid !== null && isProcessAlive(pid)) return false;
  return ageMs > STALE_MS;
}

/** Release that only removes the lock if it still carries OUR token — so a run
 *  whose (stale) lock was reclaimed by another never deletes that other run's
 *  live lock. */
function releaser(lockPath: string, token: string): () => Promise<void> {
  return async () => {
    if ((await readLockToken(lockPath)) === token) {
      await rm(lockPath, { force: true }).catch(() => {});
    }
  };
}

/**
 * Acquire the install lock. Returns a release function to call (best-effort) in
 * a finally once the destructive phase completes. Throws InstallLockError if a
 * live install already holds it.
 */
export async function acquireInstallLock(
  lockPath: string = LOCK_PATH,
): Promise<() => Promise<void>> {
  // The lock is taken before createDirectories runs, so ensure its parent
  // (~/.claude/tmp) exists first — otherwise the O_EXCL create fails ENOENT on
  // a first-ever install.
  await mkdir(dirname(lockPath), { recursive: true });

  const token = randomUUID();
  try {
    await createLockExclusive(lockPath, token);
    return releaser(lockPath, token);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Lock present — reclaim only if stale, else refuse.
  if (!(await lockIsStale(lockPath))) {
    throw new InstallLockError(
      `Another cc-settings install is in progress (lock: ${lockPath}). ` +
        "Wait for it to finish, or if you're sure none is running, delete the lock file and re-run.",
    );
  }
  // Atomically claim the stale lock by renaming it aside. rename() is atomic, so
  // if two runs both saw it as stale, exactly ONE wins the rename; the loser
  // gets ENOENT and refuses rather than deleting the winner's fresh lock and
  // double-entering the destructive section. (A plain rm-then-create can't
  // serialize this: the loser's rm clobbers the winner's just-created lock.)
  const quarantine = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new InstallLockError(
        `Another install reclaimed the lock first (${lockPath}). Re-run in a moment.`,
      );
    }
    throw err;
  }
  await rm(quarantine, { force: true }).catch(() => {});
  // We won the reclaim. A fresh EEXIST now would be a genuine concurrent create;
  // anything else (EACCES, ENOSPC, …) is a real failure and must surface.
  try {
    await createLockExclusive(lockPath, token);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new InstallLockError(
        `Reclaimed a stale lock but another install grabbed it first (${lockPath}). Re-run in a moment.`,
      );
    }
    throw err;
  }
  return releaser(lockPath, token);
}
