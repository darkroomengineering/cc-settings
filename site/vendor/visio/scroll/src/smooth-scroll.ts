import { useBeforeLeave, useIsRouting, useLocation } from "@solidjs/router";
import { getRequestEvent, isServer } from "@solidjs/web";
import { frame, ORDER, wake } from "@visio/frame";
import Lenis from "lenis";
import type { EasingFunction, LenisOptions } from "lenis";
import { createEffect, onSettled, untrack } from "solid-js";

import { lenis, setLenis } from "./instance.ts";

export interface SmoothScrollProps {
  /** Between 0 and 1. Default 0.1. */
  lerp?: number;
  /** Seconds. Unset: the glide uses `lerp`. */
  duration?: number;
  easing?: EasingFunction;
  /** Default 1. */
  wheelMultiplier?: number;
}

function warnSecond(): void {
  console.warn(
    "[@visio/scroll] A second <SmoothScroll> mounted while one is running. Keep one, inside the router."
  );
}

/** Lenis on the window, stepped by the frame loop. Place it once, inside the router. */
export function SmoothScroll(props: SmoothScrollProps) {
  // The server render reports a second one in the dev server's terminal; the
  // check in onSettled below covers one that only the client mounts.
  if (import.meta.env.DEV && isServer && !claimRequest(getRequestEvent())) {
    warnSecond();
  }

  // Also on the server, where it only takes the hydration id the client will use.
  onSettled(() => {
    if (import.meta.env.DEV && lenis()) {
      warnSecond();
    }

    const instance = new Lenis(lenisOptions(props));
    const stop = drive(instance);
    const stopAnchors = glideAnchors(instance);
    setLenis(instance);

    return () => {
      stop();
      stopAnchors();
      instance.destroy();

      if (lenis() === instance) {
        setLenis(undefined);
      }
    };
  });

  if (!isServer) {
    // A listener, not a computation: it takes no hydration id, so client-only is safe.
    useBeforeLeave(() => stopGlide(lenis()));
    // The router scrolls when the navigation commits, which can be long after
    // it started, and a wheel in between starts a new glide. Transparent, so
    // it takes no hydration id.
    const isRouting = useIsRouting();
    const location = useLocation();
    createEffect(
      () => ({
        url: location.pathname + location.search + location.hash,
        routing: isRouting(),
      }),
      ({ routing }) => {
        if (!routing) {
          stopGlide(untrack(lenis));
        }
      },
      { transparent: true }
    );
  }

  return null;
}

/** Dev only: the server requests whose render has mounted a `SmoothScroll`. */
const requests = new WeakSet<WeakKey>();

/**
 * Dev only: records that the render of `request` mounts a `SmoothScroll`.
 * False when one already did; true outside a request, where there is nothing
 * to compare with.
 */
export function claimRequest(request?: WeakKey): boolean {
  if (!request) {
    return true;
  }

  if (requests.has(request)) {
    return false;
  }

  requests.add(request);

  return true;
}

/** Puts Lenis on the frame loop; returns the stop. */
export function drive(instance: Lenis): () => void {
  const off = frame(
    ({ time }) => {
      instance.raf(time);

      return instance.isScrolling === "smooth";
    },
    { order: ORDER.scroll, label: "lenis" }
  );

  const offGesture = instance.on("gesture", wake);
  const offScroll = instance.on("scroll", wake);
  // Lenis has no event for a scrollTo.
  const { scrollTo } = instance;
  // SAFETY: the wrapper passes every argument on, so it keeps each overload.
  instance.scrollTo = ((...args: Parameters<typeof scrollTo>) => {
    wake();

    return scrollTo.apply(instance, args);
  }) as typeof scrollTo;

  return () => {
    off();
    offGesture();
    offScroll();
    instance.scrollTo = scrollTo;
  };
}

/** True from a click that starts an anchor glide until the task after it. */
let anchorClick = false;

/**
 * Glides to the target of a same-page hash link. The router still takes the
 * click: it pushes the URL and jumps to the target, and Lenis, mid-glide,
 * ignores the jump. A capture listener on the document, so it runs before
 * the router's handler and measures from the scroll Lenis knows.
 */
export function glideAnchors(instance: Lenis): () => void {
  function onClick(event: MouseEvent): void {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    if (
      event.defaultPrevented ||
      instance.isLocked ||
      instance.prefersReducedMotion
    ) {
      return;
    }

    const link = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement
      );

    if (!link?.hash || link.target || link.hasAttribute("download")) {
      return;
    }

    // The router does not scroll for `noscroll`.
    if (link.hasAttribute("noscroll")) {
      return;
    }

    const here = window.location;

    if (
      link.origin !== here.origin ||
      link.pathname !== here.pathname ||
      link.search !== here.search
    ) {
      return;
    }

    const target = document.getElementById(
      decodeURIComponent(link.hash.slice(1))
    );

    if (!target) {
      return;
    }

    instance.scrollTo(target);
    // The navigation the click starts stops the glide twice, in this task and
    // in a microtask after it.
    anchorClick = true;
    setTimeout(() => {
      anchorClick = false;
    }, 0);
  }

  document.addEventListener("click", onClick, { capture: true });

  return () =>
    document.removeEventListener("click", onClick, { capture: true });
}

/**
 * Stops a running glide and syncs Lenis to where the page is, except for the
 * navigation of a click that started an anchor glide. `reset()` is private in
 * Lenis's types but public at runtime (darkroomengineering/lenis#554);
 * `scrollTo(immediate)` would also swallow the router's next scroll event.
 */
export function stopGlide(instance: Lenis | undefined) {
  if (anchorClick) {
    return;
  }

  instance?.["reset"]();
}

export function lenisOptions(props: SmoothScrollProps): LenisOptions {
  const glide = defined({
    lerp: props.lerp,
    duration: props.duration,
    easing: props.easing,
  });

  return {
    wheel: { ...glide, ...defined({ multiplier: props.wheelMultiplier }) },
    programmatic: glide,
    autoRaf: false,
    anchors: false,
    stopInertiaOnNavigate: false,
  };
}

/** Lenis spreads each option group over its defaults, so an unset prop must be absent, not undefined; remove it when darkroomengineering/lenis#553 is fixed. */
function defined<T extends object>(options: T): Partial<T> {
  // SAFETY: the entries are those of options, less the undefined ones.
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
