import { frame, wake } from "@visio/frame";
import { createSignal, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

type Side = "top" | "center" | "bottom";

/** A line of the element, then a line of the viewport: `top bottom` is when the element's top meets the viewport's bottom. */
export type ScrollEdge = `${Side} ${Side}`;

export interface ScrollProgressOptions {
  /** Where progress is 0. Default `top bottom`, as the element enters. */
  start?: ScrollEdge;
  /** Where progress is 1. Default `bottom top`, as it leaves. */
  end?: ScrollEdge;
}

const SHARE: Record<Side, number> = { top: 0, center: 0.5, bottom: 1 };

function lines(edge: ScrollEdge): [number, number] {
  // SAFETY: a ScrollEdge is two Side words and a space.
  const [element = "top", viewport = "top"] = edge.split(" ") as Side[];

  return [SHARE[element], SHARE[viewport]];
}

/** How far the element is from `start` to `end`, clamped to 0 to 1, at a scroll of 0 for the box. */
export function progressOf(
  box: { top: number; height: number },
  viewport: number,
  start: ScrollEdge,
  end: ScrollEdge
): number {
  const [fromElement, fromViewport] = lines(start);
  const [toElement, toViewport] = lines(end);
  // The scroll at which each pair of lines meets, relative to now.
  const from = box.top + fromElement * box.height - fromViewport * viewport;
  const to = box.top + toElement * box.height - toViewport * viewport;

  if (to === from) {
    return from <= 0 ? 1 : 0;
  }

  return Math.min(1, Math.max(0, -from / (to - from)));
}

/**
 * The element's progress through the viewport, 0 to 1, from where `start`
 * lines meet to where `end` lines meet. Call it in a component body.
 */
export function useScrollProgress(
  element: () => Element | undefined,
  options: ScrollProgressOptions = {}
): Accessor<number> {
  const { start = "top bottom", end = "bottom top" } = options;
  const [progress, setProgress] = createSignal(0, { ownedWrite: true });

  function measure() {
    const target = element();

    if (target) {
      const box = target.getBoundingClientRect();
      setProgress(progressOf(box, window.innerHeight, start, end));
    }

    // Lenis keeps the loop running while it glides; a native scroll wakes it.
    return false;
  }

  onSettled(() => {
    const off = frame(measure);
    // Capture, so the scroll of a nested scroller reaches it too.
    window.addEventListener("scroll", wake, { capture: true, passive: true });
    window.addEventListener("resize", wake);
    const resize = new ResizeObserver(() => wake());
    resize.observe(document.documentElement);

    return () => {
      off();
      window.removeEventListener("scroll", wake, { capture: true });
      window.removeEventListener("resize", wake);
      resize.disconnect();
    };
  });

  return progress;
}
