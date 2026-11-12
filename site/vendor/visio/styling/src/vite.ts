import type { Plugin } from "vite";

import { styling as stylingPlugin } from "./plugin.ts";

/** The Vite plugin; place it before `solid()`. The app imports the sheet with `import '@visio/styling/css'`. */
export function styling(): Plugin[] {
  return stylingPlugin();
}
