import { warn } from "./warn.ts";

/** Where a handler result came from, for the dev-time messages. */
export interface ResultContext {
  kind: "exit" | "enter";
  /** Path and search of the page the handler belongs to. */
  page: string;
}

interface AnimeLike {
  cancel: () => void;
  onPause?: (self: AnimeLike) => void;
  /** A `JSAnimation`'s parsed targets; a timeline has none of its own. */
  targets?: unknown[];
  /** A timeline's children, a linked list of animations. Internal to anime.js, read in dev only. */
  _head?: AnimeLike;
  _next?: AnimeLike;
}

function isAnimation(value: unknown): value is AnimeLike {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "cancel" in value &&
    typeof value.cancel === "function"
  );
}

function empty(a: AnimeLike): boolean {
  return Array.isArray(a.targets) && a.targets.length === 0;
}

/** Dev only: an animation with no targets is what a ref that was never passed produces. */
function checkTargets(result: AnimeLike, kind: string, page: string) {
  let missing = empty(result) ? 1 : 0;

  // oxlint-disable-next-line no-underscore-dangle -- anime.js keeps a timeline's children here
  for (let child = result._head; child; child = child._next) {
    if (empty(child)) {
      missing += 1;
    }
  }

  if (missing > 0) {
    warn(
      `the ${kind} of ${page} animates ${missing === 1 ? "an empty target list" : `${missing} empty target lists`}. A ref the handler reads was never bound: check that the component renders the element and passes it up through its ref prop.`
    );
  }
}

/**
 * Turns a handler result into a promise that settles when the motion is
 * over: an anime.js 4 animation or timeline, cancelled when `signal`
 * aborts, or a plain promise, which nothing cancels. The runtime moves on
 * at the abort itself, so this only has to resolve. Duck-typed, so the
 * outlet loads no anime.js.
 */
export function awaitMotion(
  result: unknown,
  signal: AbortSignal,
  context: ResultContext
): PromiseLike<unknown> | undefined {
  if (result === null || result === undefined) {
    return;
  }

  if (!isAnimation(result)) {
    return Promise.resolve(result);
  }

  if (import.meta.env.DEV) {
    checkTargets(result, context.kind, context.page);
  }

  // anime.js cancels an animation when a newer one replaces its tweens, and
  // a cancelled animation never completes, so its pause counts as its end.
  const { promise: paused, resolve }: PromiseWithResolvers<void> =
    Promise.withResolvers();

  const { onPause } = result;
  result.onPause = (self) => {
    onPause?.(self);
    resolve();
  };

  signal.addEventListener("abort", () => result.cancel(), { once: true });

  return Promise.race([Promise.resolve(result), paused]);
}
