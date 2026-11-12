import type { Plugin } from "vite";

import { images as imagesPlugin } from "./images-vite.ts";
import { svg as svgPlugin } from "./svg-vite.ts";

export function images(): Plugin {
  return imagesPlugin();
}

export function svg(): Plugin {
  return svgPlugin();
}
