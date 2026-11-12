import type { Page } from "./runtime.ts";

/** The live region's id; one per document, whatever mounts it. */
const ANNOUNCER = "visio-announcer";

/**
 * A polite live region for the landed page's title. Added on mount, because
 * a screen reader only speaks changes to a region that already exists.
 */
export function mountAnnouncer() {
  if (document.querySelector(`#${ANNOUNCER}`)) {
    return;
  }

  const el = document.createElement("div");
  el.id = ANNOUNCER;
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.style.cssText =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
  document.body.append(el);
}

let latest = 0;

/**
 * Reads the landed page's title out, because focus on a nav link or on a
 * nameless wrapper says nothing. Written a timeout after the page settles,
 * when the head has the title from the preload's data. Cleared first, so the
 * same title twice is heard twice.
 */
export function announceLanded(page: Pick<Page, "settled">) {
  const el = document.querySelector(`#${ANNOUNCER}`);

  if (!el) {
    return;
  }

  latest += 1;
  const landing = latest;
  el.textContent = "";
  announceAfter(page.settled, el, landing);
}

async function announceAfter(
  settled: Promise<void>,
  el: Element,
  landing: number
): Promise<void> {
  await settled;
  setTimeout(() => {
    if (landing === latest) {
      el.textContent = document.title;
    }
  }, 0);
}
