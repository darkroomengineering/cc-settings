import type { ImageFormat } from "./types.ts";

/**
 * The part of `Bun.Image` this package uses. Declared here, not through the
 * Bun types: the app's tsconfig would then let browser code use `Bun` too.
 */
interface BunImage {
  resize: (width: number, height?: number) => BunImage;
  webp: (options: { quality: number }) => BunImage;
  jpeg: (options: { quality: number }) => BunImage;
  png: () => BunImage;
  bytes: () => Promise<Uint8Array>;
  metadata: () => Promise<{ width: number; height: number; format: string }>;
  readonly width: number;
  readonly height: number;
}

interface BunRuntime {
  version: string;
  Image: { new (input: Uint8Array): BunImage; backend: "system" | "bun" };
}

let ready = false;

function bun(): BunRuntime {
  // SAFETY: Bun sets globalThis.Bun to its runtime; under Node it is undefined, which the check below catches.
  const runtime = (globalThis as { Bun?: BunRuntime }).Bun;

  if (!runtime) {
    throw new Error(
      "[@visio/image-optimizer] encodes with Bun.Image, so Vite has to run on Bun: `bun --bun vite`."
    );
  }

  if (!ready) {
    // macOS defaults to its system resize, whose bytes differ from Linux:
    // one source would encode to other files, and other cache entries, per machine.
    runtime.Image.backend = "bun";
    ready = true;
  }

  return runtime;
}

/** The Bun version, whose codecs encode every variant. */
export function encoder(): string {
  return bun().version;
}

function image(bytes: Uint8Array): BunImage {
  return new (bun().Image)(bytes);
}

export interface ImageMetadata {
  width: number;
  height: number;
  aspectRatio: number;
  format: ImageFormat;
}

/** Dimensions as displayed, so EXIF-rotated photos report the upright size. */
export async function imageMetadata(bytes: Uint8Array): Promise<ImageMetadata> {
  const { width, height, format } = await image(bytes).metadata();

  if (format !== "jpeg" && format !== "png" && format !== "webp") {
    throw new Error(
      `[@visio/image-optimizer] cannot encode a ${format} source.`
    );
  }

  return { width, height, aspectRatio: width / height, format };
}

export interface EncodeOptions {
  quality: number;
}

/** Resizes to `width` (EXIF-rotated) and encodes; returns the real output size. */
export async function resizeAndEncode(
  bytes: Uint8Array,
  width: number,
  format: ImageFormat,
  opts: EncodeOptions
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const img = image(bytes).resize(width);

  if (format === "webp") {
    img.webp({ quality: opts.quality });
  } else if (format === "jpeg") {
    img.jpeg({ quality: opts.quality });
  } else {
    img.png();
  }

  const out = await img.bytes();

  return { bytes: out, width: img.width, height: img.height };
}

function withoutProfile(webp: Uint8Array): Uint8Array {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const chunks: Uint8Array[] = [webp.subarray(0, 12)];

  for (let at = 12; at + 8 <= webp.length;) {
    const type = String.fromCodePoint(...webp.subarray(at, at + 4));
    const length = view.getUint32(at + 4, true);
    const end = at + 8 + length + (length % 2);

    if (type !== "ICCP") {
      chunks.push(webp.subarray(at, end));
    }

    at = end;
  }

  const out = Buffer.concat(chunks);
  out.writeUInt32LE(out.length - 8, 4);

  if (out.toString("latin1", 12, 16) === "VP8X") {
    out.writeUInt8(out.readUInt8(20) & ~0x20, 20);
  }

  return out;
}

/**
 * The characters a `data:image/svg+xml,` URI has to escape to survive in a
 * CSS `url("…")` and in HTML: the rest of the SVG stays readable text.
 */
const SVG_URI_ESCAPES = /[<>#"%]/gv;

/**
 * A WebP at most 16px on its long side, in an SVG with a blur, as a
 * URL-encoded data URI stretched to the image's box.
 */
export async function placeholderSvg(
  bytes: Uint8Array,
  width: number,
  height: number
): Promise<string> {
  const long = Math.max(width, height);

  const tiny = image(bytes)
    .resize(
      Math.max(1, Math.round((16 * width) / long)),
      Math.max(1, Math.round((16 * height) / long))
    )
    .webp({ quality: 60 });

  // No profile: a blur needs no exact colour, and a P3 one is ~500 bytes.
  const webp = Buffer.from(withoutProfile(await tiny.bytes())).toString(
    "base64"
  );

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'>` +
    `<filter id='b'><feGaussianBlur stdDeviation='${long / 40}'/></filter>` +
    `<image width='${width}' height='${height}' preserveAspectRatio='none' filter='url(#b)' ` +
    `href='data:image/webp;base64,${webp}'/></svg>`;

  return `data:image/svg+xml,${svg.replaceAll(SVG_URI_ESCAPES, (c) => encodeURIComponent(c))}`;
}
