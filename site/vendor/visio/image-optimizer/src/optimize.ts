import {
  cacheKey,
  readCache,
  shortHash,
  sourceHash,
  writeCache,
} from "./cache.ts";
import { imageMetadata, placeholderSvg, resizeAndEncode } from "./encode.ts";
import type {
  ImageFormat,
  ImageVariant,
  OptimizedImage,
  ImageOptions,
} from "./types.ts";

/** Covers phone, tablet, laptop and 2x variants of each up to 4K. */
export const DEFAULT_WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const QUALITY = { webp: 80, jpeg: 85 };

export const MIME: Record<ImageFormat, string> = {
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

const EXT: Record<ImageFormat, string> = {
  webp: "webp",
  jpeg: "jpg",
  png: "png",
};

/** File extensions the optimizer accepts as input. */
export const INPUT_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export function srcset(entries: { url: string; width: number }[]): string {
  return entries.map((e) => `${e.url} ${e.width}w`).join(", ");
}

/**
 * Encodes in progress by cache key, so imports of one file with different
 * sizes share their common widths.
 */
const inflight = new Map<string, Promise<Uint8Array>>();

/** Makes the bytes, writes them to the cache, and leaves `inflight` once settled. */
async function encodeAndStore(
  cacheDir: string,
  key: string,
  ext: string,
  make: () => Promise<Uint8Array>
): Promise<Uint8Array> {
  try {
    const bytes = await make();

    try {
      await writeCache(cacheDir, key, ext, bytes);
    } catch (error) {
      console.warn(
        `[@visio/image-optimizer] could not write the cache in ${cacheDir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return bytes;
  } finally {
    inflight.delete(key);
  }
}

/** The bytes for a cache key: from an encode in progress, from the cache, or made now. */
async function produce(
  { cacheDir, used }: ImageOptions,
  key: string,
  ext: string,
  make: () => Promise<Uint8Array>
): Promise<{ bytes: Uint8Array; cached: boolean }> {
  used?.add(`${key}.${ext}`);
  const pending = inflight.get(key);

  if (pending) {
    return { bytes: await pending, cached: false };
  }

  const hit = await readCache(cacheDir, key, ext);

  if (hit) {
    return { bytes: hit, cached: true };
  }

  // Another load can start the same encode while the cache read is out.
  let job = inflight.get(key);

  if (!job) {
    job = encodeAndStore(cacheDir, key, ext, make);
    inflight.set(key, job);
  }

  return { bytes: await job, cached: false };
}

export async function optimizeImage(
  source: Uint8Array,
  options: ImageOptions
): Promise<OptimizedImage> {
  const meta = await imageMetadata(source);

  // Never upscale: a width above the source becomes the source width.
  const widths = [
    ...new Set(
      (options.widths ?? DEFAULT_WIDTHS).map((w) => Math.min(w, meta.width))
    ),
  ].toSorted((a, b) => a - b);

  const formats: ImageFormat[] =
    meta.format === "webp" ? ["webp"] : ["webp", meta.format];

  const digest = sourceHash(source);
  const hash = shortHash(digest);

  async function variant(
    format: ImageFormat,
    width: number
  ): Promise<ImageVariant> {
    const q = format === "png" ? 100 : QUALITY[format];
    const key = cacheKey(digest, `${width}|${format}|${q}`);
    const ext = EXT[format];
    const name = `${options.name}-${hash}-${width}w.${ext}`;
    // The encoded file's real size, not the requested width.
    let size: { width: number; height: number } | undefined;

    const { bytes, cached } = await produce(options, key, ext, async () => {
      const encoded = await resizeAndEncode(source, width, format, {
        quality: q,
      });

      size = { width: encoded.width, height: encoded.height };

      return encoded.bytes;
    });

    // Bytes from the cache or from another load's encode: read their header.
    size ??= await imageMetadata(bytes);

    return {
      width: size.width,
      height: size.height,
      format,
      bytes,
      name,
      cached,
    };
  }

  const variants = await Promise.all(
    formats.flatMap((format) => widths.map((width) => variant(format, width)))
  );

  let placeholder: string | undefined;

  if (options.placeholder !== false) {
    const key = cacheKey(digest, "placeholder|16|webp");

    const { bytes } = await produce(options, key, "txt", async () =>
      Buffer.from(await placeholderSvg(source, meta.width, meta.height))
    );

    placeholder = Buffer.from(bytes).toString();
  }

  return {
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.aspectRatio,
    format: meta.format,
    variants,
    widths,
    placeholder,
  };
}
