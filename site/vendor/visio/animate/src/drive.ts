import { frame, ORDER, wake } from "@visio/frame";

export interface AnimeEngine {
  useDefaultMainLoop: boolean;
  update: () => void;
  wake: () => void;
  /** The first running animation or timer; null when none runs. */
  _head: unknown;
}

const driven = new Map<AnimeEngine, () => void>();

function noop(): void {
  // The first drive() of an engine owns its stop.
}

/** Steps anime.js at `ORDER.animation`; returns the stop the tests and a hot update need. */
export function drive(engine: AnimeEngine): () => void {
  // A hot update runs index.ts again; the engine must not step twice a frame.
  if (driven.has(engine)) {
    return noop;
  }

  engine.useDefaultMainLoop = false;
  const wakeEngine = engine.wake;
  // anime.js calls it when an animation starts.
  engine.wake = wake;

  const off = frame(
    () => {
      engine.update();

      // oxlint-disable-next-line no-underscore-dangle -- the field name is anime.js's
      return !!engine._head;
    },
    { order: ORDER.animation, label: "anime.js" }
  );

  function stop(): void {
    if (driven.get(engine) !== stop) {
      return;
    }

    driven.delete(engine);
    off();
    engine.wake = wakeEngine;
    engine.useDefaultMainLoop = true;
    // The flag alone does not restart anime.js's loop while it plays.
    engine.wake();
  }

  driven.set(engine, stop);

  return stop;
}

// A hot update of this module starts with an empty map, while frame.ts keeps
// the callbacks the old one added.
import.meta.hot?.dispose(() => {
  for (const stop of driven.values()) {
    stop();
  }
});
