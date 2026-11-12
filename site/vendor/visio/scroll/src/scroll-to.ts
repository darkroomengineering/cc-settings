import { reducedMotion } from "@visio/frame";
import { untrack } from "solid-js";

import { lenis } from "./instance.ts";

/**
 * A pixel offset from the top, a selector, or an element. Not an SVG
 * element: Lenis reads its own `x` and `y` as a position
 * (darkroomengineering/lenis#551).
 */
export type ScrollTarget = number | string | HTMLElement;

export interface ScrollToOptions {
  /** Pixels added to the target. Default 0. */
  offset?: number;
  /** Jumps instead of gliding. Default false; always a jump under reduced motion. */
  immediate?: boolean;
}

/** Scrolls the page: Lenis glides when `<SmoothScroll />` runs, the browser glides otherwise. */
export function scrollTo(target: ScrollTarget, options: ScrollToOptions = {}) {
  const instance = untrack(lenis);

  if (instance) {
    instance.scrollTo(target, {
      offset: options.offset ?? 0,
      immediate: options.immediate ?? false,
    });

    return;
  }

  const top = position(target, options.offset ?? 0);

  if (top === undefined) {
    return;
  }

  window.scrollTo({
    top,
    behavior: options.immediate || reducedMotion() ? "instant" : "smooth",
  });
}

const TOP = new Set(["top", "left", "start", "#"]);
const BOTTOM = new Set(["bottom", "right", "end"]);

// Where Lenis 2 would land (`resolveScrollTargets()`): its keywords, `#id`
// by getElementById, and an element's top less its scroll-margin-top and
// the root's scroll-padding-top.
function position(target: ScrollTarget, offset: number): number | undefined {
  if (isOffset(target)) {
    return target + offset;
  }

  if (isSelector(target)) {
    if (TOP.has(target)) {
      return offset;
    }

    if (BOTTOM.has(target)) {
      return (
        document.documentElement.scrollHeight - window.innerHeight + offset
      );
    }
  }

  const element = isSelector(target) ? find(target) : target;

  if (!(element instanceof HTMLElement)) {
    if (target === "#top") {
      return offset;
    }

    if (import.meta.env.DEV) {
      console.warn(
        `[@visio/scroll] scrollTo() found no HTMLElement for ${isSelector(target) ? `"${target}"` : "its target"}, so the page stays. An SVG element is not a target: scroll to the HTML element around it.`
      );
    }

    return undefined;
  }

  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
  const padding = getComputedStyle(document.documentElement).scrollPaddingTop;

  const paddingPx = padding.endsWith("%")
    ? (Number.parseFloat(padding) / 100) * window.innerHeight
    : Number.parseFloat(padding);

  return (
    element.getBoundingClientRect().top +
    window.scrollY -
    (margin || 0) -
    (paddingPx || 0) +
    offset
  );
}

function find(selector: string): Element | null {
  // `#25` is an id but no selector: querySelector() throws on it.
  return selector.startsWith("#")
    ? // oxlint-disable-next-line unicorn/prefer-query-selector -- the line above.
      document.getElementById(selector.slice(1))
    : document.querySelector(selector);
}

function isOffset(target: ScrollTarget): target is number {
  return typeof target === "number";
}

function isSelector(target: ScrollTarget): target is string {
  return typeof target === "string";
}

let locks = 0;
let saved = { overflow: "", gutter: "" };

/**
 * Stops the page from scrolling, by the wheel, touch, the keyboard and the
 * scrollbar, until every lock is released. Returns the release of this
 * lock; a second call of it does nothing. For a modal or a menu.
 */
export function lockScroll(): () => void {
  locks += 1;

  if (locks === 1) {
    const root = document.documentElement;
    saved = {
      overflow: root.style.overflow,
      gutter: root.style.scrollbarGutter,
    };

    // Keeps the scrollbar's width, so the page does not shift; only where a
    // scrollbar takes width at all.
    if (window.innerWidth > root.clientWidth) {
      root.style.scrollbarGutter = "stable";
    }

    // On <html>, not <body>: Lenis reads the root's overflow and stops.
    root.style.overflow = "hidden";
    untrack(lenis)?.lock();
  }

  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    locks -= 1;

    if (locks > 0) {
      return;
    }

    const root = document.documentElement;
    root.style.overflow = saved.overflow;
    root.style.scrollbarGutter = saved.gutter;
    untrack(lenis)?.unlock();
  };
}
