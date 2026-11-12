import type { Screens } from "./types.ts";

/** The name of the design in effect. */
export type ScreenName = keyof Screens;

interface ViewportState {
  width: number;
  height: number;
  /** The width the design scales against: `width`, capped at `layout.maxWidth`. */
  frame: number;
  screen: ScreenName;
}

interface Stop {
  name: ScreenName;
  /** Design width in px. */
  width: number;
  /** Viewport width the design starts at; the base has none. */
  from?: number;
}

const listeners = new Set<(v: ViewportState) => void>();
let state: ViewportState = { width: 0, height: 0, frame: 0, screen: "mobile" };
let installed = false;
let maxWidth = Number.POSITIVE_INFINITY;
let fluid = true;
let rootFontSize = 16;

let stops: Stop[] = [
  { name: "mobile", width: 375 },
  { name: "desktop", width: 1440, from: 800 },
];

function screenAt(width: number): ScreenName {
  const [first] = stops;

  if (!first) {
    throw new Error("[@visio/styling] The viewport has no screens.");
  }

  let current = first.name;

  for (const s of stops) {
    if (s.from === undefined || width >= s.from) {
      current = s.name;
    }
  }

  return current;
}

function measure(): ViewportState {
  rootFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize
  );
  // `100vw` includes the scrollbar, so CSS and JS agree when we use innerWidth.
  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    width,
    height,
    frame: Math.min(width, maxWidth),
    screen: screenAt(width),
  };
}

function update() {
  state = measure();

  for (const l of listeners) {
    l(state);
  }
}

let pending = 0;

function onResize() {
  if (pending) {
    return;
  }

  pending = requestAnimationFrame(() => {
    pending = 0;
    update();
  });
}

let queries: MediaQueryList[] = [];

/** Listens at every screen's start, so crossing one updates without a resize event. */
function watchStops() {
  for (const q of queries) {
    q.removeEventListener("change", onResize);
  }

  queries = stops
    .filter((s) => s.from !== undefined)
    .map((s) => window.matchMedia(`(width >= ${s.from}px)`));

  for (const q of queries) {
    q.addEventListener("change", onResize);
  }
}

function install() {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;
  state = measure();
  window.addEventListener("resize", onResize, { passive: true });
  watchStops();
}

/**
 * Set by `defineTokens()`; must match the CSS breakpoints and `--frame`.
 * A read before it measured with the default stops, so it measures again.
 */
export function configureViewport(
  next: readonly Stop[],
  max = Number.POSITIVE_INFINITY,
  isFluid = true
) {
  stops = next.map((s) => ({ name: s.name, width: s.width, from: s.from }));
  maxWidth = max;
  fluid = isFluid;

  if (!installed) {
    return;
  }

  watchStops();
  update();
}

/** CSS px in one design px now: the value of `--dp`. */
export function dpPx(): number {
  install();

  if (!fluid) {
    return rootFontSize / 16;
  }

  const stop = stops.find((s) => s.name === state.screen);

  if (!stop) {
    throw new Error(`[@visio/styling] No screen named ${state.screen}.`);
  }

  return state.frame / stop.width;
}

export const viewport = {
  get width() {
    install();

    return state.width;
  },
  get height() {
    install();

    return state.height;
  },
  /** `min(width, layout.maxWidth)`: what `--frame` resolves to. */
  get frame() {
    install();

    return state.frame;
  },
  /** The design in effect, by screen name. */
  get screen(): ScreenName {
    install();

    return state.screen;
  },
  /** Subscribe to resize. Returns an unsubscribe function. */
  subscribe(fn: (v: ViewportState) => void) {
    install();
    listeners.add(fn);

    return () => listeners.delete(fn);
  },
};
