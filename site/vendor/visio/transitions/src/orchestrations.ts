/**
 * What an orchestration receives. `PageTransitions` disposes the old page
 * when the orchestration's promise settles.
 */
export interface Steps {
  /** Runs the exit handlers of the old page and of the chrome. */
  exit: () => Promise<void>;
  /** Runs the enter handlers of the new page and of the chrome. */
  enter: () => Promise<void>;
  /** Resolves once the new page has rendered and the promises its preload returned have landed. */
  settled: () => Promise<void>;
  /**
   * Takes the old page off screen now, for a sequence that no longer shows
   * it; otherwise it stays until the returned promise settles.
   */
  remove: () => void;
  /** Aborted when another navigation interrupts the transition. */
  signal: AbortSignal;
}

export interface Orchestration {
  (steps: Steps): Promise<void>;
  /** The wrapper on top during this sequence; `exiting` when absent. */
  above?: "exiting" | "entering";
}

/**
 * Exit, wait for the data, remove the old page, enter. The removal comes
 * first, so a curtain in the chrome uncovers the new page.
 */
export async function sequential({
  exit,
  enter,
  settled,
  remove,
}: Steps): Promise<void> {
  await exit();
  await settled();
  remove();
  await enter();
}

/** The old page leaves while the new page enters, once its data has landed. */
export async function overlap({ exit, enter, settled }: Steps): Promise<void> {
  const leaving = exit();
  await settled();
  await Promise.all([leaving, enter()]);
}

/** The new page enters over the old one, which leaves afterwards. */
export const enterLed: Orchestration = Object.assign(
  async ({ exit, enter, settled }: Steps) => {
    await settled();
    await enter();
    await exit();
  },
  { above: "entering" as const }
);
