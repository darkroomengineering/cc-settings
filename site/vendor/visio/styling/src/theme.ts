import { createSignal } from "solid-js";

/** `light` is the base palette; `dark` is the `dark` theme of the tokens, `[data-theme=dark]` on `<html>`. */
export type Theme = "light" | "dark";

const KEY = "visio-theme";

/**
 * The document's inline script: applies the saved theme, or the system's
 * when the visitor never chose, before first paint, so a dark-mode visitor
 * never sees a light flash. Render it in `<head>` with `innerHTML`.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||(t===null&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}})()`;

const [theme, setSignal] = createSignal<Theme>("light");
const [restored, setRestored] = createSignal(false);

/** The theme on the page. `light` until `restoreTheme()` reads what the script applied. */
export { theme };

/** Whether `restoreTheme()` has run, so `theme()` is the visitor's. */
export { restored };

// With route themes on, `<html>` follows the page: routeThemes() writes it, from theme() on a page without one.
let managed = false;

export function manageRoot(): void {
  managed = true;
}

function show(next: Theme) {
  setSignal(next);

  if (managed) {
    return;
  }

  if (next === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

/** Shows the theme and saves it as the visitor's choice. */
export function setTheme(next: Theme) {
  show(next);

  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage is off (a private window); the choice lasts until a reload.
  }
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}

/**
 * Brings the signal up to the saved theme, or the system one, without
 * saving it. Call once after hydration: the server rendered `light`.
 */
export function restoreTheme() {
  let saved: string | null = null;

  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // Storage is off; the system preference decides.
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  show(saved === "dark" || (saved === null && prefersDark) ? "dark" : "light");
  setRestored(true);
}
