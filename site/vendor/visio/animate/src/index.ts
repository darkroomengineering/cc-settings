import { engine as animeEngine } from "animejs/engine";

import { drive } from "./drive.ts";

drive(animeEngine);

export * from "./anime.ts";

export type * from "animejs";

export { easing } from "./easing.ts";

export { splitText } from "./split.ts";

export type {
  SplitEffect,
  SplitLevel,
  SplitOptions,
  TextSplit,
} from "./split.ts";

export { useAnime } from "./use-anime.ts";

export type { AnimeOptions } from "./use-anime.ts";

/**
 * The engine for its defaults and time unit. The loop is the package's: a
 * local export takes precedence over the `export *` above, so the loop
 * fields are left out of the type.
 */
export const engine: Omit<
  typeof animeEngine,
  "useDefaultMainLoop" | "update" | "wake"
> = animeEngine;
