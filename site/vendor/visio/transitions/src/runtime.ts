import { awaitMotion } from "./anime.ts";
import type { ResultContext } from "./anime.ts";
import type { Orchestration, Steps } from "./orchestrations.ts";
import { warn } from "./warn.ts";

/** `browser` is back or forward; `appear` is the first load with `appear`. */
export type Trigger = "link" | "browser" | "appear";

export interface Navigation {
  /** Path and search of the page that leaves; on `appear`, the first page. */
  from: string;
  /** Path and search of the page that enters. */
  to: string;
  trigger: Trigger;
}

export interface HandlerArgs extends Navigation {
  /** The wrapper of the page the handler belongs to. */
  page: HTMLElement;
  /** Aborted when another navigation interrupts the transition. */
  signal: AbortSignal;
}

/** Returns an anime.js animation or timeline, a promise, or nothing. */
export type Handler = (args: HandlerArgs) => unknown;

export interface TransitionHandlers {
  exit?: Handler;
  enter?: Handler;
}

export type State = "entering" | "exiting" | undefined;

export interface Scope {
  handlers: Set<TransitionHandlers>;
  /** The wrapper this scope's handlers receive as `page`; the running page's when absent. */
  el?: () => HTMLElement | undefined;
  /**
   * The scope of the page in this one's layout slot. It enters and leaves
   * with its layout, so a run over the layout runs its handlers too.
   */
  child?: () => Scope | undefined;
  /** Path and search of the page, for dev messages. */
  url?: () => string;
  /** Dev only: how many mounted components declared a transition in this scope. */
  declared?: number;
}

/** What the runtime needs from a page; `PageTransitions` adds the rendering side. */
export interface Page {
  /** Path and search the page was mounted for. */
  url: string;
  el?: HTMLElement;
  /** The box the leaving page had at the moment of navigation; it is fixed there. */
  rect?: DOMRect;
  /** Stacking while both pages are on screen: 2 paints over 1. */
  layer: 1 | 2;
  /** The handlers the page's components registered. */
  scope: Scope;
  /** Resolves once the page's own render has settled and its preload data has landed. */
  settled: Promise<void>;
  setState: (state: State) => void;
  /** Shows the page; it is hidden from mount until its enter runs. */
  reveal: () => void;
}

export interface NavigateOptions {
  /** Swap the pages without handlers, once the new page has settled. */
  skip?: boolean;
  orchestrate: Orchestration;
  /** The leaving wrapper's box before the router's scroll reset; measured now when absent. */
  rect?: DOMRect;
}

export interface RuntimeOptions<P extends Page> {
  /** The page on screen at creation. */
  first: P;
  /** Handlers registered outside any page: the nav, a canvas, a curtain. */
  chrome: Scope;
  /** Called with the stack whenever it changes: one page at rest, two during a transition. */
  onPages: (pages: P[]) => void;
  /** Milliseconds before a transition whose promise never resolves is force-completed. */
  timeout?: number;
  /** Receives a rejected orchestration; the browser's `reportError` when absent. */
  onError?: (error: unknown) => void;
  /**
   * Called once a navigation has put its page at rest, animated or skipped;
   * not for an interrupted one, and not for `appear`.
   */
  onLanded?: (page: P) => void;
  /** The stack of the layout whose slot this stack is. */
  parent?: () => Pick<Runtime<Page>, "running" | "covered"> | undefined;
}

export interface Runtime<P extends Page> {
  /** The page that is current or entering: the last of the stack. */
  current: () => P;
  /** Starts a transition to `to`, interrupting a running one. */
  navigate: (to: P, nav: Navigation, options: NavigateOptions) => void;
  /**
   * The first load with `appear`: waits for the page to settle, runs its
   * enter when `animate`, then puts it at rest. A navigation cuts it short,
   * and after one it does nothing.
   */
  appear: (animate: boolean) => Promise<void>;
  /** Whether a transition or appear is running. */
  running: () => boolean;
  /**
   * Whether a stack above is running. Its enter walks into this stack's
   * page, so a navigation here swaps in place.
   */
  covered: () => boolean;
  /** Stops a running transition or appear without finishing it: the outlet that owns the stack is going away. */
  stop: () => void;
}

/** Force-completes a transition whose promise never resolves. */
const TIMEOUT = 5000;

async function held({ settled, remove }: Steps): Promise<void> {
  await settled();
  remove();
}

/** Read at call time: the outlet renders on the server too, and Node has no `reportError`. */
function report(error: unknown): void {
  reportError(error);
}

/**
 * Dev only: counts one `usePageTransition` call against its page's scope and
 * warns from the second on. Returns the release for the call's cleanup, so a
 * component that remounts under the same page (a hot reload) is not counted
 * twice.
 */
export function declare(scope: Scope): () => void {
  scope.declared = (scope.declared ?? 0) + 1;

  if (scope.declared > 1) {
    const page = scope.url?.();
    warn(
      `usePageTransition was called twice under ${page ? `the page ${page}` : "one page"}. A page declares its transition once; components inside it hand their elements up through a ref prop instead.`
    );
  }

  return () => {
    scope.declared = (scope.declared ?? 1) - 1;
  };
}

function aborted(signal: AbortSignal): Promise<void> {
  const { promise, resolve }: PromiseWithResolvers<void> =
    Promise.withResolvers();

  if (signal.aborted) {
    resolve();
  } else {
    signal.addEventListener("abort", () => resolve(), { once: true });
  }

  return promise;
}

/** Settles with `result`, handing a rejection to `onRejected`. */
async function caught(
  result: PromiseLike<unknown>,
  onRejected: (error: unknown) => void
): Promise<void> {
  try {
    await result;
  } catch (error) {
    onRejected(error);
  }
}

/**
 * Runs one kind of handler of a page, of the pages in its layout slots, and
 * of the chrome; resolves once every animation and promise they returned
 * has settled, or on abort. Each handler receives its own page's wrapper.
 */
export async function run(
  kind: keyof TransitionHandlers,
  page: Page,
  chrome: Scope,
  nav: Navigation,
  signal: AbortSignal,
  onError: (error: unknown) => void = report
): Promise<void> {
  const { el } = page;

  if (!el || signal.aborted) {
    return;
  }

  // Reveal in the same tick in which the handlers set their first frame, so
  // both paint together.
  if (kind === "enter") {
    page.reveal();
  }

  const scopes: Scope[] = [];

  for (
    let scope: Scope | undefined = page.scope;
    scope;
    scope = scope.child?.()
  ) {
    scopes.push(scope);
  }

  scopes.push(chrome);
  const context: ResultContext = { kind, page: page.url };

  // An animation cancelled on abort rejects; that is the interruption, not an error.
  function rejected(error: unknown): void {
    if (!signal.aborted) {
      onError(error);
    }
  }

  const pending: PromiseLike<unknown>[] = [];

  for (const scope of scopes) {
    const args: HandlerArgs = { ...nav, page: scope.el?.() ?? el, signal };

    for (const handlers of scope.handlers) {
      try {
        const result = awaitMotion(handlers[kind]?.(args), signal, context);

        if (result) {
          pending.push(caught(result, rejected));
        }
      } catch (error) {
        onError(error);
      }
    }
  }

  await Promise.race([Promise.all(pending), aborted(signal)]);
}

export function createRuntime<P extends Page>(
  options: RuntimeOptions<P>
): Runtime<P> {
  const {
    chrome,
    onPages,
    onError = report,
    onLanded,
    parent,
    timeout = TIMEOUT,
  } = options;

  let pages: P[] = [options.first];

  function current(): P {
    const page = pages.at(-1);

    if (!page) {
      throw new Error("[@visio/transitions] The stack has no page.");
    }

    return page;
  }

  function setPages(next: P[]): void {
    pages = next;
    onPages(next);
  }

  let active:
    | { controller: AbortController; timer?: ReturnType<typeof setTimeout> }
    | undefined;

  function covered(): boolean {
    const above = parent?.();

    return !!above && (above.running() || above.covered());
  }

  // After a navigation the first page is gone or at rest; appear has nothing to do.
  let navigated = false;

  function finish(to: P): void {
    active = undefined;

    if (pages.length > 1 || pages[0] !== to) {
      setPages([to]);
    }

    to.setState(undefined);
    to.reveal();
    onLanded?.(to);
  }

  /**
   * Makes `controller` the running one, and aborts it and calls `end` when
   * it runs past the timeout. The timer restarts once `page` has settled, so
   * a slow preload does not use up the time the handlers have.
   */
  function guard(
    controller: AbortController,
    page: P,
    label: string,
    end: () => void
  ): void {
    const running: NonNullable<typeof active> = { controller };

    function arm(settled: boolean): ReturnType<typeof setTimeout> {
      return setTimeout(() => {
        if (import.meta.env.DEV) {
          warn(
            settled
              ? `${label} did not finish within ${timeout} ms of its page settling and was force-completed. A handler or the orchestration returned a promise that never settled.`
              : `${label} was force-completed: its page did not settle within ${timeout} ms. A promise its preload returned never settled.`
          );
        }

        controller.abort();
        end();
      }, timeout);
    }

    async function rearm(): Promise<void> {
      await page.settled;

      if (active !== running) {
        return;
      }

      clearTimeout(running.timer);
      running.timer = arm(true);
    }

    running.timer = arm(false);
    active = running;
    rearm();
  }

  function stop(): void {
    if (!active) {
      return;
    }

    clearTimeout(active.timer);
    active.controller.abort();
    active = undefined;
  }

  function navigate(
    to: P,
    nav: Navigation,
    { skip, orchestrate, rect }: NavigateOptions
  ): void {
    // Interrupted: the oldest page goes now, the one still entering leaves.
    stop();
    navigated = true;
    const from = current();

    if (covered()) {
      finish(to);

      return;
    }

    const sequence: Orchestration = skip ? held : orchestrate;
    const top = sequence.above ?? "exiting";
    from.layer = top === "exiting" ? 2 : 1;
    to.layer = top === "exiting" ? 1 : 2;
    from.rect = rect ?? from.el?.getBoundingClientRect();
    from.setState("exiting");
    setPages([from, to]);

    const controller = new AbortController();

    const steps: Steps = {
      exit: () => run("exit", from, chrome, nav, controller.signal, onError),
      enter: () => run("enter", to, chrome, nav, controller.signal, onError),
      // Raced against the abort, so an interrupted orchestration ends now
      // instead of when the page it no longer shows settles.
      settled: () => Promise.race([to.settled, aborted(controller.signal)]),
      // An interrupted transition no longer owns the stack.
      remove: () => {
        if (!controller.signal.aborted) {
          setPages([to]);
        }
      },
      signal: controller.signal,
    };

    function done(): void {
      if (active?.controller !== controller) {
        return;
      }

      clearTimeout(active.timer);
      finish(to);
    }

    async function conduct(conducted: Promise<void>): Promise<void> {
      try {
        await conducted;
      } catch (error) {
        onError(error);
      }

      done();
    }

    guard(controller, to, `the transition ${nav.from} → ${nav.to}`, done);
    conduct(sequence(steps));
  }

  async function appear(animate: boolean): Promise<void> {
    if (navigated) {
      return;
    }

    const first = current();
    const controller = new AbortController();

    function rest(): void {
      if (active?.controller !== controller) {
        return;
      }

      clearTimeout(active.timer);
      active = undefined;
      first.setState(undefined);
      first.reveal();
    }

    guard(controller, first, `the appear of ${first.url}`, rest);

    try {
      await Promise.race([first.settled, aborted(controller.signal)]);

      if (animate) {
        const nav: Navigation = {
          from: first.url,
          to: first.url,
          trigger: "appear",
        };

        await run("enter", first, chrome, nav, controller.signal, onError);
      }
    } finally {
      rest();
    }
  }

  return {
    current,
    navigate,
    appear,
    stop,
    running: () => active !== undefined,
    covered,
  };
}
