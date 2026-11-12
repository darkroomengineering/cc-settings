import type { Page } from "./runtime.ts";

/** The history entry the router stamped, its key for a saved scroll offset. */
function historyDepth(): number | undefined {
  // SAFETY: the router stamps every entry it writes with a numeric _depth; others are null.
  const state = window.history.state as { _depth?: number } | null;

  // oxlint-disable-next-line no-underscore-dangle -- the field name is the router's
  return state?._depth;
}

/**
 * Restores the offset on back and forward. The router restores before the
 * outlet mounts the returning page, so the short document clamps the offset.
 * Offsets are keyed by the router's `_depth` and are not recorded while a
 * navigation is in flight; a push drops the offsets forward of the entry it left.
 * The restore runs a frame after the page settles, unless a wheel, touch or
 * key press came first.
 */
export function createScrollMemory() {
  const offsets = new Map<number, number>();
  // The navigation in flight, 0 when there is none.
  let moving = 0;
  let count = 0;
  let moved = false;
  // The depth a link left from, until history shows the entry it pushed:
  // the router writes history after the outlet's effect. A push kills every
  // entry forward of the one it left; a replace keeps the depth.
  let pushedFrom: number | undefined;

  function prune(): void {
    const depth = historyDepth();

    if (
      pushedFrom === undefined ||
      depth === undefined ||
      depth <= pushedFrom
    ) {
      return;
    }

    for (const key of offsets.keys()) {
      if (key > pushedFrom) {
        offsets.delete(key);
      }
    }

    pushedFrom = undefined;
  }

  // Paused during a navigation: the pinned leaving page clamps the scroll,
  // and on back or forward history already points at the target.
  function record(): void {
    prune();
    const depth = historyDepth();

    if (!moving && depth !== undefined) {
      offsets.set(depth, window.scrollY);
    }
  }

  function onInput(): void {
    moved = true;
  }

  const inputs = ["wheel", "touchstart", "keydown"] as const;

  return {
    /** Starts recording; returns the cleanup. */
    listen() {
      window.addEventListener("scroll", record, { passive: true });

      for (const input of inputs) {
        window.addEventListener(input, onInput, { passive: true });
      }

      return () => {
        window.removeEventListener("scroll", record);

        for (const input of inputs) {
          window.removeEventListener(input, onInput);
        }
      };
    },
    /**
     * A navigation has committed and `page` is the one it lands on. Called in
     * the outlet's effect, before any scroll the navigation causes is
     * dispatched.
     */
    arrive(page: Pick<Page, "el" | "settled">, popped: boolean) {
      count += 1;
      moving = count;
      const nav = count;
      moved = false;
      prune();
      const depth = historyDepth();

      if (popped) {
        pushedFrom = undefined;
      } else {
        pushedFrom ??= depth;
      }

      const y = popped && depth !== undefined ? offsets.get(depth) : undefined;

      async function restore(): Promise<void> {
        await page.settled;
        // A frame after settling, so a <Loading> the data revealed has laid out.
        requestAnimationFrame(() => {
          prune();

          if (nav !== moving) {
            // A newer navigation owns the scroll.
            return;
          }

          moving = 0;
          // History is written by now; a depth that did not grow was a replace.
          pushedFrom = undefined;

          if (y === undefined || moved || !page.el?.isConnected) {
            return;
          }

          window.scrollTo(0, y);
        });
      }

      restore();
    },
  };
}
