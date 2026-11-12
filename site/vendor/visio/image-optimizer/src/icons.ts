import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { imageMetadata, resizeAndEncode } from "./encode.ts";
import type { OptimizedSvg } from "./svg.ts";
import { optimizeSvg, viewBoxSize } from "./svg.ts";

let wasm: Promise<void> | undefined;

function ready(): Promise<void> {
  // initWasm throws when it runs twice, so every caller shares the first call.
  wasm ??= initWasm(
    readFileSync(
      createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")
    )
  );

  return wasm;
}

function problem(
  svg: string,
  name: string,
  width: number,
  height: number
): string | undefined {
  if (/<text[\s>]/v.test(svg)) {
    return `${name} has <text>, and the build draws it with no fonts, so the PNG icons lose it. Convert the text to paths in the design tool.`;
  }

  if (Math.abs(width - height) > 0.01 * Math.max(width, height)) {
    return `${name} is ${width} by ${height}, but an icon is square. Make its viewBox square; the padding is part of the artwork.`;
  }

  return undefined;
}

type ResvgInstance = InstanceType<typeof Resvg>;

async function load(
  svg: string,
  size: number,
  name: string
): Promise<ResvgInstance> {
  await ready();

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  });

  const found =
    problem(svg, name, resvg.width, resvg.height) ??
    (resvg.imagesToResolve().length > 0
      ? `${name} links an image file, which the build does not load. Embed the image as a data: URL, or draw it as paths.`
      : undefined);

  if (found) {
    resvg.free();
    throw new Error(found);
  }

  return resvg;
}

export async function checkIconSvg(
  svg: string,
  name = "the SVG"
): Promise<void> {
  const resvg = await load(svg, 16, name);
  resvg.free();
}

export async function rasterizeSvg(
  svg: string,
  size: number,
  name = "the SVG"
): Promise<Uint8Array> {
  const resvg = await load(svg, size, name);

  try {
    const image = resvg.render();

    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

/** Whether the drawing is opaque at its four corners: a background drawn to the edge, as a touch icon needs. */
export async function fillsCorners(
  svg: string,
  name = "the SVG"
): Promise<boolean> {
  const size = 64;
  const resvg = await load(svg, size, name);

  try {
    const image = resvg.render();

    try {
      const { pixels } = image;
      const last = size - 1;

      return [
        [0, 0],
        [last, 0],
        [0, last],
        [last, last],
      ].every(([x = 0, y = 0]) => pixels[(y * size + x) * 4 + 3] === 255);
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

export async function resizePng(
  png: Uint8Array,
  size: number,
  min: number,
  name = "the PNG"
): Promise<Uint8Array> {
  const meta = await imageMetadata(png);

  if (meta.format !== "png") {
    throw new Error(`${name} is a ${meta.format}, not a PNG.`);
  }

  if (meta.width !== meta.height) {
    throw new Error(
      `${name} is ${meta.width} by ${meta.height} px, but an icon is square.`
    );
  }

  if (meta.width < min) {
    throw new Error(
      `${name} is ${meta.width} px, and the largest icon is ${min} px. Export it at ${min} px or more, or give an SVG.`
    );
  }

  if (meta.width === size) {
    return png;
  }

  const resized = await resizeAndEncode(png, size, "png", { quality: 100 });

  return resized.bytes;
}

export function encodeIco(
  images: readonly { size: number; png: Uint8Array }[]
): Uint8Array {
  const header = 6 + 16 * images.length;
  const total = images.reduce((sum, image) => sum + image.png.length, header);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header;

  for (const [i, { size, png }] of images.entries()) {
    if (size < 1 || size > 256) {
      throw new Error(`An ICO entry is 1 to 256 px, not ${size}.`);
    }

    const at = 6 + 16 * i;
    // 0 stands for 256: the field is one byte.
    out[at] = size % 256;
    out[at + 1] = size % 256;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  }

  return out;
}

const LIGHT = "visio-light";
const DARK = "visio-dark";

function box(file: OptimizedSvg): string {
  const size = viewBoxSize(file.root.attributes.viewBox ?? "");
  const width = size?.width ?? Number.parseFloat(file.width ?? "0");
  const height = size?.height ?? Number.parseFloat(file.height ?? "0");

  return `0 0 ${width} ${height}`;
}

function nested(file: OptimizedSvg, className: string): string {
  // Without a viewBox, the drawing would keep its own size in a box 100% wide.
  const viewBox =
    file.root.attributes.viewBox === undefined ? ` viewBox="${box(file)}"` : "";

  return file.svg.replace(
    /^<svg\b(?<attributes>[^>]*)>/v,
    (_, attributes: string) => {
      // x and y move a nested <svg>, while a file on its own ignores them.
      const kept = attributes
        .replaceAll(/\s(?:width|height|class|x|y)="[^"]*"/gv, "")
        .replace(/\s+$/v, "");

      return `<svg class="${className}" width="100%" height="100%"${kept}${viewBox}>`;
    }
  );
}

export function faviconSvg(light: string, dark?: string): string {
  const one = optimizeSvg(light, { path: "icon.svg" });

  if (dark === undefined) {
    return one.svg;
  }

  const two = optimizeSvg(dark, { path: "icon-dark.svg" });

  // A nested <svg> sits at 0 0 of the outer user space, so the outer box starts there.
  const viewBox = box(one);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<style>.${DARK}{display:none}@media (prefers-color-scheme:dark){.${LIGHT}{display:none}.${DARK}{display:inline}}</style>${nested(one, LIGHT)}${nested(two, DARK)}</svg>`
  );
}
