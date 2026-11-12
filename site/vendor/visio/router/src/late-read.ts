import { query as solidQuery } from "@solidjs/router";
import { isDev, isServer } from "@solidjs/web";
import { getObserver } from "solid-js";

const AFTER_COMMIT = 500;
const QUICK = 50;
const PRELOAD_TIMEOUT = 5000;

let preloading = 0;
const preloaded = new Map<string, number>();
let commit: { path: string; at: number } | undefined;
const warned = new Set<string>();

export function watchPreload<A, R>(preload: (args: A) => R): (args: A) => R {
  return (args) => {
    preloading += 1;

    try {
      return preload(args);
    } finally {
      preloading -= 1;
    }
  };
}

export function markCommit(path: string): void {
  commit = { path, at: performance.now() };
}

function shown(args: unknown[]): string {
  try {
    return JSON.stringify(args).slice(1, -1);
  } catch {
    return "…";
  }
}

function notPreloaded(
  at: number,
  committedAt: number,
  askedAt?: number
): boolean {
  return (
    at >= committedAt - QUICK &&
    at - committedAt <= AFTER_COMMIT &&
    (askedAt === undefined || at - askedAt >= PRELOAD_TIMEOUT)
  );
}

const LATE = Symbol("late");

async function landedWithin(
  result: Promise<unknown>,
  ms: number
): Promise<boolean> {
  const late = Promise.withResolvers<typeof LATE>();
  const timer = setTimeout(() => late.resolve(LATE), ms);

  try {
    return (await Promise.race([result, late.promise])) !== LATE;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function check(
  name: string,
  key: string,
  args: unknown[],
  result: Promise<unknown>
): Promise<void> {
  const at = performance.now();

  if (await landedWithin(result, QUICK)) {
    return;
  }

  if (
    !commit ||
    warned.has(key) ||
    !notPreloaded(at, commit.at, preloaded.get(key))
  ) {
    return;
  }

  warned.add(key);
  console.warn(
    `[@visio/router] [QUERY_NOT_PRELOADED] query "${name}"(${shown(args)}) started after the navigation to ${commit.path} committed, so a <Loading> on the new page shows its fallback until it lands. Start it in the route's preload. When it needs the page's data, chain it there in an async function: return { page, feed: feedOf(page) }, where feedOf awaits the page and returns getFeed(feed) (.claude/skills/router/SKILL.md, Routes and pages).`
  );
}

type Read = ((...args: unknown[]) => unknown) & {
  key: string;
  keyFor: (...args: unknown[]) => string;
};

function watchedQuery(
  fn: Parameters<typeof solidQuery>[0],
  name: string
): Read {
  // SAFETY: a query's function takes its fetcher's arguments, which this
  // wrapper passes on as they are.
  const cached = solidQuery(fn, name) as unknown as Read;

  function read(...args: unknown[]): unknown {
    const result = cached(...args);
    const key = cached.keyFor(...args);

    if (preloading > 0 || !getObserver()) {
      preloaded.set(key, performance.now());
    } else if (result instanceof Promise) {
      check(name, key, args, result);
    }

    return result;
  }

  return Object.assign(read, { key: cached.key, keyFor: cached.keyFor });
}

/** Solid Router's `query`, which warns in dev about a read no preload started (DESIGN.md, Dependent reads). */
// SAFETY: `read` keeps the key fields of the function it wraps, and the
// static methods are Solid Router's own.
export const query: typeof solidQuery =
  isDev && !isServer
    ? (Object.assign(watchedQuery, solidQuery) as unknown as typeof solidQuery)
    : solidQuery;
