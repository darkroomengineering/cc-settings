import { frame, ORDER } from "@visio/frame";
import { keepTime } from "animejs";
import type { Revertible, Scope, Tickable } from "animejs";
import { splitText as kugiri } from "kugiri";
import type { SplitOptions, TextSplit } from "kugiri";

export type { SplitLevel, SplitOptions, TextSplit } from "kugiri";

/** Builds the animation of one split: what it returns is reverted before the next split, and the next one starts at its time. */
export type SplitEffect = (split: TextSplit) => Tickable | (() => void) | void;

/** What the constructor of `useAnime` hands `splitText` while it runs. */
export interface SplitContext {
  root: Element;
  scope: Scope;
  cleanups: (() => void)[];
  /** Pauses what a new split started, when the root is off screen. */
  settle: () => void;
  /** Takes what an old split made out of the scope, which keeps every animation it ever registered. */
  forget: (revertibles: readonly Revertible[]) => void;
}

let active: SplitContext | undefined;

export function runInSplitContext<T>(context: SplitContext, run: () => T): T {
  const previous = active;
  active = context;

  try {
    return run();
  } finally {
    active = previous;
  }
}

// Read from @solidjs/web: a delegated handler sits on its node as `_$$click`.
const DELEGATED = "_$$";

function hasHandler(target: HTMLElement): boolean {
  for (const element of target.querySelectorAll("*")) {
    if (Object.keys(element).some((key) => key.startsWith(DELEGATED))) {
      return true;
    }
  }

  return false;
}

function targetsOf(root: Element, target: string | HTMLElement): HTMLElement[] {
  return target instanceof HTMLElement
    ? [target]
    : [...root.querySelectorAll<HTMLElement>(target)];
}

interface Entry {
  element: HTMLElement;
  width: number;
  split?: TextSplit | undefined;
  run: (split: TextSplit) => Tickable | (() => void);
  /** What the effect returned for the current split; keepTime makes nothing a no-op. */
  cleanup?: Tickable | (() => void) | undefined;
  /** What the effect registered with the scope for the current split. */
  made: Revertible[];
}

function undo(cleanup: Entry["cleanup"]): void {
  if (cleanup && "revert" in cleanup) {
    cleanup.revert();
  } else {
    cleanup?.();
  }
}

/**
 * Splits `target` into the lines, words and characters the browser painted,
 * and runs `effect` on the split. Call it in the constructor of `useAnime`.
 */
export function splitText(
  target: string | HTMLElement,
  options: SplitOptions,
  effect: SplitEffect
): void {
  const context = active;

  if (!context) {
    throw new Error(
      "[@visio/animate] [SPLIT_OUTSIDE_SCOPE] splitText() runs in the constructor of useAnime(), which splits the text again after a resize and reverts it with the component. Move the call there (.claude/skills/animate/SKILL.md)."
    );
  }

  const { root, scope, cleanups, settle, forget } = context;
  const elements = targetsOf(root, target);

  if (import.meta.env.DEV) {
    for (const element of elements.filter(hasHandler)) {
      console.warn(
        "[@visio/animate] [SPLIT_HAS_HANDLERS] splitText() writes the markup of its target back as new nodes on each split after a resize or a font load, so an event handler inside it stops firing then. Put the handler outside the split text (.claude/skills/animate/SKILL.md).",
        element
      );
    }
  }

  const entries = elements.map((element): Entry => ({
    element,
    width: 0,
    made: [],
    // The animation of the next split starts where the last one was, so a reveal does not play again.
    run: keepTime((split: TextSplit) => scope.execute(() => effect(split))),
  }));

  function resplit(changed: readonly Entry[]): void {
    for (const entry of changed) {
      // keepTime reverts a returned animation itself, but not a cleanup function.
      if (entry.cleanup && !("revert" in entry.cleanup)) {
        entry.cleanup();
      }

      entry.split?.revert();
    }

    // One pass for every target: kugiri plans them all before it writes.
    const splits = kugiri(
      changed.map((entry) => entry.element),
      options
    );

    for (const [index, entry] of changed.entries()) {
      const split = splits[index];

      if (!split) {
        continue;
      }

      entry.split = split;
      entry.width = entry.element.clientWidth;
      forget(entry.made);

      const start = scope.revertibles.length;
      entry.cleanup = entry.run(split);
      entry.made = scope.revertibles.slice(start);
    }

    settle();
  }

  resplit(entries);

  const pending = new Set<Entry>();
  let off: (() => void) | undefined;

  function flush(): false {
    off?.();
    off = undefined;
    resplit([...pending]);
    pending.clear();

    return false;
  }

  // Only a change of width moves a wrap: a phone's address bar changes the height alone.
  const observer = new ResizeObserver(() => {
    for (const entry of entries) {
      const width = entry.element.clientWidth;

      // A hidden target has no lines to keep.
      if (entry.split && width > 0 && width !== entry.width) {
        pending.add(entry);
      }
    }

    if (pending.size > 0 && !off) {
      off = frame(flush, { order: ORDER.animation, label: "splitText" });
    }
  });

  for (const entry of entries) {
    observer.observe(entry.element);
  }

  // A font that loads later changes the metrics of the lines.
  function fontsLoaded(): void {
    resplit(entries);
  }

  document.fonts.addEventListener("loadingdone", fontsLoaded);

  cleanups.push(() => {
    document.fonts.removeEventListener("loadingdone", fontsLoaded);
    observer.disconnect();
    off?.();

    for (const entry of entries) {
      undo(entry.cleanup);
      entry.split?.revert();
    }
  });
}
