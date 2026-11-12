/**
 * The head round trip of the smoke run: load a page in a tab of its own,
 * click a link to another page, go back, and compare the head with the
 * server's. A page loaded first is hydrated, and its head once went with the
 * first page that replaced it (#194); no single page load shows that. Only the head
 * counts: what the console says during the trip is timing, not the page.
 */
import type { Chrome } from "./chrome.ts";

const LOAD_TIMEOUT = 60_000;

/** A click before hydration is a full page load, not a client navigation. */
const HYDRATED = 1000;
const SETTLE = 500;

/** The title and every tag the head registry owns, in a form that ignores attribute order. */
const HEAD_SNAPSHOT = `JSON.stringify([document.title, ...[...document.head.querySelectorAll('[data-dh]:not(title)')]
  .map((e) => e.localName + [...e.attributes].filter((a) => !a.name.startsWith('data-dh')).map((a) => ' ' + a.name + '=' + a.value).sort().join('') + ' ' + e.textContent)
  .sort()])`;

export interface HeadTrip {
  /** False when the page links to none of `others`, so nothing was checked. */
  checked: boolean;
  /** What went wrong, when something did. */
  problem?: string;
}

export async function headTrip(
  chrome: Chrome,
  origin: string,
  path: string,
  others: readonly string[]
): Promise<HeadTrip> {
  const { send, once, open } = chrome;
  const { targetId, sessionId } = await open();

  async function evaluate<T>(expression: string): Promise<T> {
    const { result } = await send<{ result: { value: T } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );

    return result.value;
  }

  function settle(want: string) {
    return evaluate<boolean>(`new Promise((r) => {
      const t = Date.now();
      (function poll() {
        if (${want}) r(true);
        else if (Date.now() - t > 10000) r(false);
        else setTimeout(poll, 100);
      })();
    })`);
  }

  try {
    await send("Page.enable", {}, sessionId);
    const loaded = once("Page.loadEventFired", sessionId, LOAD_TIMEOUT);
    await send("Page.navigate", { url: origin + path }, sessionId);
    await loaded;
    await Bun.sleep(HYDRATED);
    const head = await evaluate<string>(HEAD_SNAPSHOT);

    const to = await evaluate<string | null>(`(() => {
      const want = new Set(${JSON.stringify(others)});
      const a = [...document.querySelectorAll('a[href^="/"]:not([target]):not([download])')]
        .find((a) => want.has(new URL(a.href).pathname));
      if (!a) return null;
      window.__headTrip = true;
      a.click();
      return new URL(a.href).pathname;
    })()`);

    if (!to) {
      return { checked: false };
    }

    if (!(await settle(`location.pathname === ${JSON.stringify(to)}`))) {
      return {
        checked: true,
        problem: `a click on the link to ${to} did not reach it within 10 s, so the head was not checked`,
      };
    }

    if (!(await evaluate<boolean>("window.__headTrip === true"))) {
      return {
        checked: true,
        problem: `the link to ${to} loaded a new document instead of a client navigation, so the head was not checked`,
      };
    }

    await Bun.sleep(SETTLE);
    await evaluate("history.back()");

    const back = await settle(
      `location.pathname === ${JSON.stringify(path)} && ${HEAD_SNAPSHOT} === ${JSON.stringify(head)}`
    );

    if (back) {
      return { checked: true };
    }

    const now: string[] = JSON.parse(await evaluate<string>(HEAD_SNAPSHOT));
    const was: string[] = JSON.parse(head);

    const diff = [
      ...was
        .values()
        .filter((t) => !now.includes(t))
        .map((t) => `lost ${t.trim()}`),
      ...now
        .values()
        .filter((t) => !was.includes(t))
        .map((t) => `got ${t.trim()}`),
    ];

    return {
      checked: true,
      problem: `the head is not the server's after a client navigation to ${to} and back: ${diff.join("; ")}`,
    };
  } catch (error) {
    return {
      checked: true,
      problem: `the head check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {
      // The tab may be gone with Chrome already.
    });
  }
}
