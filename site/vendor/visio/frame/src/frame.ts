import { onSettled } from "solid-js";
import Tempus from "tempus";
import type { TempusState } from "tempus";

export type FrameArgs = TempusState;

/** Returns `false` when it needs no next frame of its own. */
export type FrameCallback = (args: FrameArgs) => void | boolean;

/** Slots in a frame as tempus `order` values, lower first. */
export const ORDER = {
  /** Lenis moves the page. */
  scroll: -10,
  /** Animation engines (anime.js) and anything that reads the new scroll position. */
  animation: 0,
  /** A canvas or WebGL scene, drawing what the steps above settled. */
  render: 10,
} as const;

export interface FrameOptions {
  /** One of the `ORDER` slots. Default `ORDER.animation`. */
  order?: (typeof ORDER)[keyof typeof ORDER];
  /** Frames per second. Default every frame. */
  fps?: number;
  /** The name the tempus profiler shows. */
  label?: string;
}

interface Loop {
  busy: boolean;
  woken: boolean;
  skew: number;
  lastDelta: number;
  sleptAt: number;
  slept: number;
}

function fresh(): Loop {
  return {
    busy: false,
    woken: false,
    skew: 0,
    lastDelta: 1000 / 60,
    sleptAt: 0,
    slept: 0,
  };
}

// A hot update runs this module again while the callbacks the old one
// wrapped stay on tempus, so both share one state.
const loop: Loop = import.meta.hot
  ? (import.meta.hot.data.loop ??= fresh())
  : fresh();

const offs = [
  Tempus.add(
    (state) => {
      // Tempus starts a paused clock again with a frame of 0 ms, and Lenis
      // would not move in it.
      if (loop.woken && state.deltaTime === 0) {
        loop.skew += loop.lastDelta;
        state.deltaTime = loop.lastDelta;
        loop.slept = Math.max(
          0,
          performance.now() - loop.sleptAt - loop.lastDelta
        );
      } else {
        if (state.deltaTime > 0) {
          loop.lastDelta = state.deltaTime;
        }

        loop.slept = 0;
      }

      loop.woken = false;
      loop.busy = false;
      state.time += loop.skew;
    },
    { order: -Infinity, label: "@visio/frame" }
  ),
  Tempus.add(
    () => {
      // Tempus requests the next frame after the last callback, so the pause
      // waits for the microtask after it.
      if (!loop.busy) {
        queueMicrotask(sleep);
      }
    },
    { order: Infinity, label: "@visio/frame" }
  ),
];

import.meta.hot?.dispose(() => {
  for (const off of offs) {
    off?.();
  }
});

function sleep() {
  if (loop.busy || !Tempus.isPlaying) {
    return;
  }

  Tempus.pause();
  loop.sleptAt = performance.now();
}

/** Runs the loop again from the next frame. */
export function wake(): void {
  loop.busy = true;

  if (Tempus.isPlaying) {
    return;
  }

  loop.woken = true;
  Tempus.play();
}

/** Runs `callback` every frame while the component is mounted. Call it in a component body. */
export function useFrame(
  callback: FrameCallback,
  options?: FrameOptions
): void {
  // onSettled on both sides: it takes a hydration id (DESIGN.md, Rules for components).
  onSettled(() => frame(callback, options));
}

function noop(): void {
  // On the server there is no callback to remove.
}

/** How early, in ms, a throttled callback may run. */
const SLACK = 1;

/** Registers a frame callback outside a component; returns the unsubscribe. */
export function frame(
  callback: FrameCallback,
  options: FrameOptions = {}
): () => void {
  const { order = ORDER.animation, fps, label } = options;
  const every = fps === undefined || fps === Infinity;
  const throttled = every ? undefined : throttle(callback, fps);
  const run = throttled?.step ?? callback;
  // Tempus sees the callback at its default fps, so its profiler shows the fps from the label.
  const named = every ? label : `${label ?? ""} (${fps} fps)`.trimStart();

  const off = Tempus.add(
    (state) => {
      if (run(state) !== false) {
        loop.busy = true;
      }
    },
    { order, label: named }
  );

  // Tempus.add returns undefined on the server.
  if (!off) {
    return noop;
  }

  wake();

  return () => {
    off();
    throttled?.cancel();
  };
}

// Tempus runs one list per fps, which would break `order` (DESIGN.md).
interface Throttled {
  step: FrameCallback;
  cancel: () => void;
}

function throttle(step: FrameCallback, fps: number): Throttled {
  const interval = 1000 / fps;
  let elapsed = 0;
  let last: number | undefined;
  let result: ReturnType<FrameCallback>;
  let due: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    clearTimeout(due);
    due = undefined;
  }

  function throttled(state: FrameArgs): ReturnType<FrameCallback> {
    // From the frame before the first call, not from when tempus started.
    last ??= state.time - state.deltaTime;
    // `time` skips the sleep, and the fps is in time on the clock.
    elapsed += state.deltaTime + loop.slept;

    // Frame times are inexact: two 60 Hz frames add up to a hair under
    // 1000 / 30. Without the slack, 30 fps would run on every third frame,
    // then on two in a row.
    if (elapsed < interval - SLACK) {
      // A callback that lets the loop sleep would miss the last frame that
      // something else asked for.
      if (result === false) {
        due ??= setTimeout(() => {
          due = undefined;
          wake();
        }, interval - elapsed);
      }

      return result;
    }

    clearTimeout(due);
    due = undefined;
    elapsed = elapsed < interval ? 0 : elapsed % interval;
    const { deltaTime } = state;
    state.deltaTime = state.time - last;
    last = state.time;

    try {
      result = step(state);

      return result;
    } finally {
      state.deltaTime = deltaTime;
    }
  }

  return { step: throttled, cancel };
}
