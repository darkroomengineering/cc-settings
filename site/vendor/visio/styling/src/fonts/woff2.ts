import { createRequire } from "node:module";

// CommonJS without types. Loaded on the first cache miss: parsing the 950 kB
// Emscripten module is slow.
interface Wawoff2 {
  compress: (ttf: Uint8Array) => Promise<Uint8Array>;
}

let wawoff2: Wawoff2 | undefined;
let queue: Promise<unknown> = Promise.resolve();

async function compressAfter(
  previous: Promise<unknown>,
  encoder: Wawoff2,
  ttf: Uint8Array
): Promise<Uint8Array> {
  await previous;
  const compressed = await encoder.compress(ttf);

  return new Uint8Array(compressed);
}

export function encodeWoff2(ttf: Uint8Array): Promise<Uint8Array> {
  // SAFETY: wawoff2 exports compress(); it ships no types.
  wawoff2 ??= createRequire(import.meta.url)("wawoff2") as Wawoff2;
  // compress returns a view into the wasm heap that the next call overwrites,
  // so one call at a time, copied out before the next starts.
  const result = compressAfter(queue, wawoff2, ttf);
  queue = Promise.allSettled([result]);

  return result;
}
