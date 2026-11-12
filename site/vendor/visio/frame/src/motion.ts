import { createSignal, onSettled } from "solid-js";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const media =
  typeof window === "undefined" || !window.matchMedia
    ? undefined
    : window.matchMedia(REDUCED_MOTION_QUERY);

const [reducedMotion, setReducedMotion] = createSignal(media?.matches ?? false);

media?.addEventListener("change", () => setReducedMotion(media.matches));

/** Whether the visitor asked for less motion. False on the server. */
export { reducedMotion };

/**
 * Calls `onChange` with true when `element` enters the viewport and false
 * when it leaves; returns the stop. Does nothing on the server.
 */
export function watchInView(
  element: Element,
  onChange: (inView: boolean) => void,
  options?: IntersectionObserverInit
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    return noop;
  }

  // isIntersecting is true on any overlap, whatever the threshold.
  const least = Math.min(...[options?.threshold ?? 0].flat());
  let inView: boolean | undefined;

  const observer = new IntersectionObserver((entries) => {
    const entry = entries.at(-1);
    const now = !!entry?.isIntersecting && entry.intersectionRatio >= least;

    if (now === inView) {
      return;
    }

    inView = now;
    onChange(now);
  }, options);

  observer.observe(element);

  return () => observer.disconnect();
}

/** What `usePlayInView` plays: an anime.js or WAAPI animation, a `<video>`. */
export interface Playable {
  play: () => unknown;
  pause: () => unknown;
  revert?: () => unknown;
}

/**
 * Plays what `create` returns while the element is on screen, and pauses it
 * when it leaves. Call it in a component body.
 */
export function usePlayInView(
  target: () => Element | undefined,
  create: () => Playable | Playable[],
  options?: IntersectionObserverInit
): void {
  onSettled(() => {
    const element = target();

    return element ? playInView(element, create, options) : undefined;
  });
}

/** `usePlayInView` outside a component; returns the stop, which reverts. */
export function playInView(
  element: Element,
  create: () => Playable | Playable[],
  options?: IntersectionObserverInit
): () => void {
  let playables: Playable[] | undefined;
  let inView = false;

  function update(): void {
    if (inView && !media?.matches) {
      playables ??= [create()].flat();

      for (const playable of playables) {
        play(playable);
      }
    } else if (playables) {
      for (const playable of playables) {
        playable.pause();
      }
    }
  }

  const stop = watchInView(
    element,
    (now) => {
      inView = now;
      update();
    },
    options
  );

  media?.addEventListener("change", update);

  return () => {
    stop();
    media?.removeEventListener("change", update);

    for (const playable of playables ?? []) {
      if (playable.revert) {
        playable.revert();
      } else {
        playable.pause();
      }
    }
  };
}

function play(playable: Playable): void {
  const started = playable.play();

  if (started instanceof Promise) {
    ignoreRejection(started);
  }
}

async function ignoreRejection(started: Promise<unknown>): Promise<void> {
  try {
    await started;
  } catch {
    // A <video> rejects play() when a pause comes before playback starts.
  }
}

function noop(): void {
  // On the server there is nothing to stop.
}
