import { watchInView } from "@visio/frame";
import type { Playable } from "@visio/frame";
import { REDUCED_MOTION_QUERY } from "@visio/frame/internal/motion";
import { createScope } from "animejs";
import type { Revertible, Scope, ScopeParams } from "animejs";
import { onSettled } from "solid-js";

import { runInSplitContext } from "./split.ts";

export interface AnimeOptions extends Omit<ScopeParams, "root"> {
  /** Plays the scope's animations only while the root is on screen. Default false. */
  inView?: boolean | IntersectionObserverInit;
}

type Constructor = (scope: Scope) => (() => void) | void;

/** A timer, an animation, a timeline or a WAAPI animation of anime.js. */
interface Tickable extends Playable {
  paused: boolean;
  parent?: unknown;
}

function running(value: Revertible): value is Revertible & Tickable {
  return (
    "play" in value &&
    typeof value.play === "function" &&
    "pause" in value &&
    typeof value.pause === "function" &&
    "paused" in value &&
    value.paused === false &&
    // A timeline's child runs on the timeline's clock; played alone, it would not.
    !("parent" in value && value.parent)
  );
}

/**
 * Runs `constructor` in an anime.js scope on `root` once the component
 * settles, and reverts the scope with the owner. Call it in a component body.
 */
export function useAnime(
  root: () => Element | undefined,
  constructor: Constructor,
  options: AnimeOptions = {}
): void {
  onSettled(() => {
    const element = root();

    if (!element) {
      return;
    }

    const { inView, mediaQueries, ...params } = options;

    const scope = createScope({
      ...params,
      // SAFETY: anime.js only queries the root, which any Element can do.
      root: element as HTMLElement,
      mediaQueries: { reduceMotion: REDUCED_MOTION_QUERY, ...mediaQueries },
    });

    // Only what was running is paused and played again, so an animation that
    // waits for a click, or follows the scroll, is left alone.
    const held = new Set<Tickable>();
    let visible = false;

    function apply(): void {
      if (!inView) {
        return;
      }

      if (visible) {
        for (const tickable of held) {
          tickable.play();
        }

        held.clear();

        return;
      }

      for (const revertible of scope.revertibles) {
        if (!running(revertible)) {
          continue;
        }

        revertible.pause();
        held.add(revertible);
      }
    }

    // A media query change runs this again, with new animations.
    scope.add((self) => {
      if (!self) {
        throw new Error(
          "[@visio/animate] anime.js ran a scope constructor without its scope."
        );
      }

      held.clear();

      const cleanups: (() => void)[] = [];

      const cleanup = runInSplitContext(
        {
          root: element,
          scope: self,
          cleanups,
          settle: apply,
          // A reverted animation stays in the scope, and play() would start it again.
          forget(revertibles) {
            const gone = new Set<unknown>(revertibles);
            const list = self.revertibles;

            for (let i = list.length - 1; i >= 0; i -= 1) {
              if (gone.has(list[i])) {
                list.splice(i, 1);
              }
            }

            for (const tickable of held) {
              if (gone.has(tickable)) {
                held.delete(tickable);
              }
            }
          },
        },
        () => constructor(self)
      );

      apply();

      return () => {
        cleanup?.();

        for (const revert of cleanups) {
          revert();
        }
      };
    });

    if (!inView) {
      return () => scope.revert();
    }

    const stop = watchInView(
      element,
      (now) => {
        visible = now;
        apply();
      },
      inView === true ? undefined : inView
    );

    return () => {
      stop();
      scope.revert();
    };
  });
}
