import { useBeforeLeave, useLocation } from "@solidjs/router";
import type {
  Location,
  RoutePreloadFuncArgs,
  RouteSectionProps,
  SearchParams,
} from "@solidjs/router";
import { dynamic, isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { reducedMotion } from "@visio/frame";
import {
  matchChain,
  settle as settlePreload,
} from "@visio/router/internal/outlet";
import type { ChainLevel, RouterLike } from "@visio/router/internal/outlet";
import {
  createComponent,
  createContext,
  createEffect,
  createSignal,
  For,
  onSettled,
  untrack,
  useContext,
} from "solid-js";

import { announceLanded, mountAnnouncer } from "./announcer.ts";
import { sequential } from "./orchestrations.ts";
import type { Orchestration } from "./orchestrations.ts";
import { createRuntime, declare } from "./runtime.ts";
import type {
  Navigation,
  Page,
  Runtime,
  Scope,
  State,
  TransitionHandlers,
  Trigger,
} from "./runtime.ts";
import { createScrollMemory } from "./scroll-memory.ts";

export interface PageTransitionsProps {
  /** The `createRouter` instance the app renders; the outlet matches against its tree. */
  router: RouterLike;
  /** Mounts the first page as entering and runs its enter handlers once `ready`. */
  appear?: boolean;
  /** With `appear`: the gate for the first enter, true when the preloader is done. */
  ready?: boolean;
  /** True swaps without handlers; `forced` is true under reduced motion or a covering layout. */
  skip?: (nav: Navigation, forced: boolean) => boolean;
  /** The sequence; `sequential` when absent. Read at each navigation, so it may change. */
  orchestrate?: Orchestration;
}

/** Handlers registered outside any page: the nav, a canvas, a curtain. */
const chrome: Scope = { handlers: new Set() };
const PageScope = createContext<Scope>(chrome);

/**
 * Registers handlers for the component's lifetime. Inside a page they run
 * for that page's exit and enter; inside a layout, when the section enters
 * or leaves; in the shell they take part in every navigation. A component
 * calls it once.
 */
export function usePageTransition(handlers: TransitionHandlers) {
  const scope = useContext(PageScope);

  // Counted in the body, not in onSettled, so the server render reports a
  // second call too, in the dev server's terminal. No computation, so no
  // hydration id.
  const release =
    import.meta.env.DEV && scope !== chrome ? declare(scope) : undefined;

  onSettled(() => {
    scope.handlers.add(handlers);

    return () => {
      scope.handlers.delete(handlers);
      release?.();
    };
  });
}

/** One level of the chain, mounted for one URL. */
interface Entry extends Page {
  level: ChainLevel;
  /** 0 for the outlet's own stack, 1 for a layout's slot, and so on. */
  depth: number;
  /**
   * Pinned to the URL the entry was mounted for. A level that stays through
   * a navigation is moved to the new one: a shared layout, or the page when
   * only the query changed.
   */
  location: () => Location;
  move: (location: Location) => void;
  intent: Exclude<RoutePreloadFuncArgs["intent"], "preload">;
  state: () => State;
  /**
   * Hidden until its enter runs, so a page that waits for data does not
   * show at full opacity under the leaving one.
   */
  hidden: () => boolean;
  settle: () => void;
  /** Promises the preloads of this level and the levels mounted with it returned, awaited by `settled`. */
  data: Promise<unknown>[];
  /** The stack in this level's `children` slot; absent on the last level. */
  child?: Stack;
  /** The wrapper's box when the navigation began, before the router's scroll reset. */
  measured?: DOMRect;
}

interface Stack {
  runtime: Runtime<Entry>;
  pages: () => Entry[];
}

function searchParams(search: string): SearchParams {
  const out: SearchParams = {};

  for (const [key, value] of new URLSearchParams(search)) {
    const prev = out[key];

    if (prev === undefined) {
      out[key] = value;
    } else if (Array.isArray(prev)) {
      out[key] = [...prev, value];
    } else {
      out[key] = [prev, value];
    }
  }

  return out;
}

/** The item at `index`, which the caller has checked is in range. */
function at<T>(list: readonly T[], index: number): T {
  const item = list[index];

  if (item === undefined) {
    throw new Error(
      `[@visio/transitions] No level ${index} in a chain of ${list.length}.`
    );
  }

  return item;
}

/** A copy of the router's live location; nothing on it moves later. */
function pin(live: Location): Location {
  return {
    pathname: live.pathname,
    search: live.search,
    hash: live.hash,
    query: searchParams(live.search),
    state: live.state,
    key: live.key,
  };
}

/** The same route with the same values for the params its own pattern names. */
function sameLevel(a: ChainLevel, b: ChainLevel): boolean {
  if (a.pattern !== b.pattern) {
    return false;
  }

  for (const match of a.pattern.matchAll(/[:*](?<name>\w+)/gv)) {
    const name = match.groups?.name;

    if (name === undefined) {
      throw new Error(
        "[@visio/transitions] A param of the pattern has no name."
      );
    }

    if (a.params[name] !== b.params[name]) {
      return false;
    }
  }

  return true;
}

/**
 * Focuses a landed page when focus went with the page that left, so a
 * screen reader starts at the new content. Focus on something that stayed,
 * or a URL with a hash, is left alone. In a timeout, so the wrapper is
 * visible and can take focus.
 */
function focusLanded(page: Entry) {
  setTimeout(() => {
    const active = document.activeElement;

    if (active && active !== document.body && active.isConnected) {
      return;
    }

    if (window.location.hash) {
      return;
    }

    page.el?.focus({ preventScroll: true });
  }, 0);
}

function landed(page: Entry) {
  focusLanded(page);
  announceLanded(page);
}

function createStack(first: Entry, parent?: () => Runtime<Entry>): Stack {
  const [pages, setPages] = createSignal<Entry[]>([first]);

  const runtime = createRuntime<Entry>({
    first,
    chrome,
    parent,
    onPages: setPages,
    onLanded: landed,
  });

  return { runtime, pages };
}

/**
 * Level `depth` of `chain`, and below it a stack for each deeper level,
 * mounted together. They share `data`, so the top one settles when every
 * preload under it has landed. `stack` is the runtime the entry goes into.
 */
function createEntry(
  chain: ChainLevel[],
  depth: number,
  location: Location,
  intent: Entry["intent"],
  state: State,
  stack: () => Runtime<Entry>,
  data: Promise<unknown>[] = []
): Entry {
  const [location$, setLocation] = createSignal(location);
  const [state$, setState] = createSignal<State>(state);
  const [hidden, setHidden] = createSignal(state === "entering");

  const { promise: rendered, resolve: settle }: PromiseWithResolvers<void> =
    Promise.withResolvers();

  // onSettled fires while a <Loading> inside still shows its fallback, and
  // Solid 2 has no public hook on child boundaries, so also wait for what
  // preload returned.
  const settled = settledAfter(rendered, data);

  const entry: Entry = {
    url: location.pathname + location.search,
    level: at(chain, depth),
    depth,
    location: location$,
    move: (next) => {
      entry.url = next.pathname + next.search;
      setLocation(next);
    },
    intent,
    scope: { handlers: new Set(), el: () => entry.el, url: () => entry.url },
    layer: 1,
    state: state$,
    setState,
    hidden,
    reveal: () => setHidden(false),
    settled,
    settle,
    data,
  };

  function own(): Runtime<Entry> {
    if (!entry.child) {
      throw new Error(
        "[@visio/transitions] A layout entry has no stack in its slot."
      );
    }

    return entry.child.runtime;
  }

  if (depth + 1 < chain.length) {
    const child: Stack = createStack(
      createEntry(chain, depth + 1, location, intent, undefined, own, data),
      stack
    );

    entry.child = child;
    entry.scope.child = () => child.runtime.current().scope;
  }

  return entry;
}

async function settledAfter(
  rendered: Promise<void>,
  data: Promise<unknown>[]
): Promise<void> {
  await rendered;
  await Promise.allSettled(data);
}

async function handled(data: Promise<unknown>): Promise<void> {
  try {
    await data;
  } catch {
    // The page sees the rejection through `data`.
  }
}

/** What the router would pass the entry's page, its slot holding the stack below. */
function levelProps(entry: Entry): RouteSectionProps {
  const { level, child } = entry;

  // Untracked: a preload reads the router's queries, and the revalidation
  // after an action would run this again and mount the page a second time.
  const data = untrack(() =>
    level.preload?.({
      params: level.params,
      location: entry.location(),
      intent: entry.intent,
    })
  );

  // Solid Router marks a preload's queries handled only under a private flag
  // this call cannot set. Mark the rejection handled so it cannot exit the
  // server; the page still sees it through data.
  const pending = settlePreload(data);

  if (pending instanceof Promise) {
    handled(pending);
    entry.data.push(pending);
  }

  let slot: JSX.Element;

  return {
    params: level.params,
    get location() {
      return entry.location();
    },
    data,
    get children() {
      return child
        ? (slot ??= createComponent(StackView, { stack: child, tag: "div" }))
        : undefined;
    },
  };
}

/**
 * Fixed, not absolute: with smooth scrolling the document moves for several
 * frames after the scroll reset. An explicit z-index on both pages, or the
 * one with a transform or opacity below 1 paints on top. The origin is the
 * viewport centre, so a scale pivots on what is visible.
 */
function wrapperStyle(entry: Entry): JSX.CSSProperties {
  // `layer` and `rect` are plain fields: the runtime writes them before the
  // `setState` and `onPages` calls that rerun this.
  const state = entry.state();

  const style: JSX.CSSProperties = {
    // Focusable for `focusLanded`, without a ring around the whole page.
    outline: "none",
    "pointer-events": state ? "none" : undefined,
    visibility: entry.hidden() ? "hidden" : undefined,
    "z-index": state ? String(entry.layer) : undefined,
  };

  const { rect } = entry;

  if (state === "exiting" && rect) {
    style.position = "fixed";
    style.top = `${rect.top}px`;
    style.left = `${rect.left}px`;
    style.width = `${rect.width}px`;
    style["transform-origin"] = `50% ${window.innerHeight / 2 - rect.top}px`;
  } else if (state === "entering") {
    style.position = "relative";
  }

  return style;
}

/**
 * One stack: the outlet's, in `<main>`, or a layout slot's, in `<div>`. What
 * the outlet needs is inline, so it ships no stylesheet.
 */
function StackView(props: { stack: Stack; tag: "main" | "div" }) {
  const stack = untrack(() => props.stack);
  const tag = untrack(() => props.tag);
  const Wrapper = dynamic(() => tag);
  // A layout that leaves takes its slot with it; a transition running there
  // stops. After the render that removed it, not inside: the abort runs the
  // handlers' listeners, and one that writes state would write in an owned
  // scope.
  onSettled(() => () => queueMicrotask(() => stack.runtime.stop()));

  return (
    <For each={stack.pages()}>
      {(entry) => {
        onSettled(() => entry.settle());
        const pageProps = levelProps(entry);

        function ref(el: HTMLElement): void {
          entry.el = el;
        }

        return (
          <PageScope value={entry.scope}>
            <Wrapper
              ref={ref}
              tabindex={-1}
              data-transition={entry.state()}
              inert={entry.state() === "exiting"}
              style={wrapperStyle(entry)}
            >
              {createComponent(entry.level.component, pageProps)}
            </Wrapper>
          </PageScope>
        );
      }}
    </For>
  );
}

export function PageTransitions(props: PageTransitionsProps) {
  const location = useLocation();
  const router = untrack(() => props.router);
  const appear = untrack(() => props.appear === true);

  const root = untrack(() => {
    const url = location.pathname + location.search;
    const chain = matchChain(router.routes, router.match(url));

    const first = createEntry(
      chain,
      0,
      pin(location),
      "initial",
      appear ? "entering" : undefined,
      () => root.runtime
    );

    return createStack(first);
  });

  /** The entries on screen now, outlet first, each the current one of its stack. */
  function path(): Entry[] {
    const out: Entry[] = [];

    for (let entry: Entry | undefined = root.runtime.current(); entry;) {
      out.push(entry);
      entry = entry.child?.runtime.current();
    }

    return out;
  }

  // Whether the navigation is back or forward: a history traversal confirms
  // with a number, and the router's intent is gone by the time the effect
  // runs. The same hook measures every level before the router's scroll
  // reset, since which level changes is only known after the commit.
  let popped = false;
  // `<html>`'s theme before the commit: the next page's may replace it before the effect runs.
  let shown: string | undefined;

  const scroll = createScrollMemory();

  if (!isServer) {
    useBeforeLeave((e) => {
      for (const entry of path()) {
        entry.measured = entry.el?.getBoundingClientRect();
      }

      popped = typeof e.to === "number";
      shown = document.documentElement.dataset.theme;
    });
  }

  createEffect(
    () => location.pathname + location.search,
    (url, prev) => {
      if (prev === undefined) {
        return;
      }

      const trigger: Trigger = popped ? "browser" : "link";
      // Untracked on purpose: the compute above is the trigger, the entry
      // pins the URL it was mounted for, and `skip` or `orchestrate` may read
      // signals of their own, which dev would otherwise report as reads in
      // an effect callback.
      untrack(() => {
        const chain = matchChain(router.routes, router.match(url));
        const pinned = pin(location);
        const current = path();
        // Down the levels that stay, to the first that changes.
        let depth = 0;

        while (
          depth < chain.length - 1 &&
          current[depth + 1] &&
          sameLevel(at(current, depth).level, at(chain, depth))
        ) {
          at(current, depth).move(pinned);
          depth += 1;
        }

        const from = at(current, depth);
        const rect = from.measured;

        for (const entry of current) {
          entry.measured = undefined;
        }

        if (
          depth === chain.length - 1 &&
          current.length === chain.length &&
          sameLevel(from.level, at(chain, depth))
        ) {
          // The same page with the same params: only the query changed. The
          // page stays and reads the new one, like a layout that stays.
          from.move(pinned);
          scroll.arrive(from, false);

          return;
        }

        const stack = depth === 0 ? root : at(current, depth - 1).child;

        if (!stack) {
          throw new Error(
            "[@visio/transitions] A layout that stays has no stack in its slot."
          );
        }

        const to = createEntry(
          chain,
          depth,
          pinned,
          popped ? "native" : "navigate",
          "entering",
          () => stack.runtime
        );

        // The leaving page keeps its colours while `<html>` takes the next page's (route themes, @visio/styling).
        if (shown !== undefined && from.el) {
          from.el.dataset.theme = shown;
        }

        const nav: Navigation = { from: prev, to: url, trigger };
        const forced = reducedMotion() || stack.runtime.covered();
        stack.runtime.navigate(to, nav, {
          skip: props.skip?.(nav, forced) || forced,
          orchestrate: props.orchestrate ?? sequential,
          rect,
        });
        scroll.arrive(to, popped);
      });
    }
  );

  // On both sides, though it only runs in the browser: a component has no
  // owner of its own, so onSettled takes a hydration id from this one, and
  // registering it on the client alone shifts the page's ids after it.
  onSettled(() => {
    mountAnnouncer();

    return scroll.listen();
  });

  if (appear) {
    let started = false;
    createEffect(
      () => props.ready ?? true,
      (ready) => {
        if (!ready || started) {
          return;
        }

        started = true;
        void root.runtime.appear(!reducedMotion());
      }
    );
  }

  return createComponent(StackView, { stack: root, tag: "main" });
}
