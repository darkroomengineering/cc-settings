import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// HB_MEMORY_MODE_WRITABLE with no destroy callback: harfbuzz reads the buffer
// in place and never frees it, so the buffer is ours to free once the source
// face is gone. The subset face owns a fresh blob and does not point back.
const HB_MEMORY_MODE_WRITABLE = 2;

// HB_SUBSET_SETS_LAYOUT_FEATURE_TAG: the input set of layout feature tags to
// keep. By default it holds a short list (kern, liga, calt, ...) and every
// other feature is dropped: stylistic sets, `case`, small caps. A design that
// turns one on with `font-feature-settings` would silently lose it.
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

// Subsetter settings that change the output for the same inputs. Part of the
// cache key, so a change here re-encodes instead of serving an older entry.
export const SUBSET_SETTINGS = "layout-features=all";

interface HbExports {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  hb_blob_create: (
    data: number,
    length: number,
    mode: number,
    user_data: number,
    destroy: number
  ) => number;
  hb_blob_destroy: (blob: number) => void;
  hb_blob_get_length: (blob: number) => number;
  hb_blob_get_data: (blob: number, length_out: number) => number;
  hb_face_create: (blob: number, index: number) => number;
  hb_face_destroy: (face: number) => void;
  hb_face_reference_blob: (face: number) => number;
  hb_subset_input_create_or_fail: () => number;
  hb_subset_input_destroy: (input: number) => void;
  hb_subset_input_unicode_set: (input: number) => number;
  hb_subset_input_set: (input: number, set_type: number) => number;
  hb_set_clear: (set: number) => void;
  hb_set_add: (set: number, codepoint: number) => void;
  hb_set_invert: (set: number) => void;
  hb_subset_or_fail: (face: number, input: number) => number;
  hb_subset_input_pin_axis_location: (
    input: number,
    face: number,
    tag: number,
    value: number
  ) => number;
  /** WASI reactor entry: runs the static constructors once, before any other call. */
  _initialize?: () => void;
}

let instancePromise: Promise<HbExports> | null = null;

function getWasmPath(): string {
  return createRequire(import.meta.url).resolve(
    "harfbuzzjs/dist/harfbuzz-subset.wasm"
  );
}

// The subset build is a WASI reactor with no imports: it brings its own
// memory and grows it itself, so instantiation takes an empty import object.
async function loadInstance(): Promise<HbExports> {
  const wasmBytes = await readFile(getWasmPath());
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const { exports } = instance;

  if (!isHbExports(exports)) {
    throw new TypeError(
      `[@visio/styling] ${getWasmPath()} has no hb_subset_or_fail export`
    );
  }

  // oxlint-disable-next-line no-underscore-dangle -- the export name is WASI's
  exports._initialize?.();

  return exports;
}

/** The harfbuzzjs subset build, told apart by the export every subset calls. */
function isHbExports(
  exports: WebAssembly.Exports
): exports is WebAssembly.Exports & HbExports {
  return typeof exports.hb_subset_or_fail === "function";
}

// A failed load is not kept, so the next call tries again.
async function loadOnce(): Promise<HbExports> {
  try {
    return await loadInstance();
  } catch (error) {
    instancePromise = null;
    throw error;
  }
}

function getInstance(): Promise<HbExports> {
  instancePromise ??= loadOnce();

  return instancePromise;
}

/** OpenType tag as a big-endian uint32: 'wght' -> 0x77676874. */
function tagOf(tag: string): number {
  if (tag.length !== 4) {
    throw new Error(
      `[@visio/styling] axis tag "${tag}" must be four characters`
    );
  }

  return (
    ((tag.charCodeAt(0) << 24) |
      (tag.charCodeAt(1) << 16) |
      (tag.charCodeAt(2) << 8) |
      tag.charCodeAt(3)) >>>
    0
  );
}

/**
 * Subsets to `codepoints` (`'all'` keeps every mapped one). `axes` pins those
 * axes; the others stay variable.
 */
export async function subsetTtf(
  input: Uint8Array,
  codepoints: number[] | "all",
  axes: Record<string, number> = {}
): Promise<Uint8Array> {
  // Before anything is allocated in the wasm heap, so a bad tag leaks nothing.
  const pins = Object.entries(axes).map(
    ([name, value]): [string, number, number] => [name, tagOf(name), value]
  );

  const hb = await getInstance();

  const fontPtr = hb.malloc(input.byteLength);

  if (fontPtr === 0) {
    throw new Error("[@visio/styling] the wasm heap has no room for the font");
  }

  new Uint8Array(hb.memory.buffer).set(input, fontPtr);

  const blobIn = hb.hb_blob_create(
    fontPtr,
    input.byteLength,
    HB_MEMORY_MODE_WRITABLE,
    0,
    0
  );

  const face = hb.hb_face_create(blobIn, 0);
  hb.hb_blob_destroy(blobIn);

  try {
    return subsetFace(hb, face, codepoints, pins);
  } finally {
    hb.free(fontPtr);
  }
}

function subsetFace(
  hb: HbExports,
  face: number,
  codepoints: number[] | "all",
  pins: [name: string, tag: number, value: number][]
): Uint8Array {
  const subsetInput = hb.hb_subset_input_create_or_fail();
  let out = 0;

  try {
    if (subsetInput === 0) {
      throw new Error(
        "[@visio/styling] the wasm heap has no room for a subset"
      );
    }

    // An inverted empty set is every tag, as hb-subset --layout-features='*'.
    const featureSet = hb.hb_subset_input_set(
      subsetInput,
      HB_SUBSET_SETS_LAYOUT_FEATURE_TAG
    );

    hb.hb_set_clear(featureSet);
    hb.hb_set_invert(featureSet);
    const unicodeSet = hb.hb_subset_input_unicode_set(subsetInput);

    // An inverted empty set is every code point; the face keeps what it has.
    if (codepoints === "all") {
      hb.hb_set_invert(unicodeSet);
    } else {
      for (const cp of codepoints) {
        hb.hb_set_add(unicodeSet, cp);
      }
    }

    for (const [name, tag, value] of pins) {
      if (
        !hb.hb_subset_input_pin_axis_location(subsetInput, face, tag, value)
      ) {
        throw new Error(
          `[@visio/styling] the font has no "${name}" axis to pin`
        );
      }
    }

    out = hb.hb_subset_or_fail(face, subsetInput);
  } finally {
    hb.hb_subset_input_destroy(subsetInput);
    hb.hb_face_destroy(face);
  }

  if (out === 0) {
    throw new Error(
      "[@visio/styling] HarfBuzz could not subset the font (is it an OTF or TTF file?)"
    );
  }

  const blobOut = hb.hb_face_reference_blob(out);

  try {
    const length = hb.hb_blob_get_length(blobOut);
    const dataPtr = hb.hb_blob_get_data(blobOut, 0);

    // slice() creates an owned copy — safe to destroy the blob right after.
    return new Uint8Array(hb.memory.buffer, dataPtr, length).slice();
  } finally {
    hb.hb_blob_destroy(blobOut);
    hb.hb_face_destroy(out);
  }
}
