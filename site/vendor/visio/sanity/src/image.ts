import { stegaClean } from "@sanity/client/stega";
import type {
  CdnImageSource,
  DescribedImageSource,
  ResponsiveImage,
} from "@visio/image-optimizer";
import { selectWidths } from "@visio/image-optimizer/internal/select";
import type { MetaImage } from "@visio/router";

import { cdnSize, cropRect, imageSize, isSvg } from "./asset.ts";
import type { Rect } from "./asset.ts";

export interface SanityImageValue {
  asset?: {
    url?: string | null;
    // No dimensions: the size is in the CDN URL.
    metadata?: { lqip?: string | null } | null;
  } | null;
  // Optional fields, as typegen generates them.
  hotspot?: { x?: number; y?: number; width?: number; height?: number } | null;
  crop?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null;
  alt?: string | null;
}

/** A `ResponsiveImage` with the editor's alt text. `sources` is empty: the CDN picks the format (`auto=format`). */
export interface SanityImageAttributes extends ResponsiveImage {
  alt: string;
}

/**
 * `DescribedImageSource` (alt optional) when the value has an `alt` field,
 * else `CdnImageSource` (alt required).
 */
export type SanityImageSource<T = SanityImageValue> =
  "alt" extends keyof NonNullable<T> ? DescribedImageSource : CdnImageSource;

const QUALITY = 80;

const WIDTHS: readonly number[] = [
  480, 768, 1024, 1440, 1920, 2560, 2880, 3840,
];

/** The hotspot's centre in source px. Without a complete hotspot the CDN crops around the centre. */
function hotspotCentre(
  image: SanityImageValue,
  size: { width: number; height: number }
) {
  const { x, y, width, height } = image.hotspot ?? {};

  const complete =
    x !== undefined &&
    y !== undefined &&
    width !== undefined &&
    height !== undefined;

  const h = complete
    ? { x, y, width, height }
    : { x: 0.5, y: 0.5, width: 1, height: 1 };

  // Through the edges, as `@sanity/image-url` rounds it, so the URLs stay the ones the CDN has cached.
  const left = h.x * size.width - (h.width * size.width) / 2;
  const right = h.x * size.width + (h.width * size.width) / 2;
  const top = h.y * size.height - (h.height * size.height) / 2;
  const bottom = h.y * size.height + (h.height * size.height) / 2;

  return {
    x: Math.round((right - left) / 2 + left),
    y: Math.round((bottom - top) / 2 + top),
  };
}

/** The largest part of the crop at `ratio`, centred on the hotspot and kept inside the crop. */
function fitRect(
  crop: Rect,
  centre: { x: number; y: number },
  ratio: number
): Rect {
  if (crop.width / crop.height > ratio) {
    const width = Math.round(crop.height * ratio);
    const left = Math.round(centre.x - width / 2);

    return {
      left: Math.min(Math.max(left, crop.left), crop.left + crop.width - width),
      top: crop.top,
      width,
      height: crop.height,
    };
  }

  const height = Math.round(crop.width / ratio);
  const top = Math.round(centre.y - height / 2);

  return {
    left: crop.left,
    top: Math.min(Math.max(top, crop.top), crop.top + crop.height - height),
    width: crop.width,
    height,
  };
}

/**
 * One CDN URL: `w` wide, and `h` tall cropped around the hotspot when given,
 * else scaled down (`fit=max`, never up) inside the editor's crop.
 */
function cdnUrl(
  url: string,
  image: SanityImageValue,
  size: { width: number; height: number },
  w: number,
  h?: number
): string {
  const crop = cropRect(image, size);
  const rect = h ? fitRect(crop, hotspotCentre(image, size), w / h) : crop;
  const params: string[] = [];

  if (
    rect.left ||
    rect.top ||
    rect.width !== size.width ||
    rect.height !== size.height
  ) {
    params.push(`rect=${rect.left},${rect.top},${rect.width},${rect.height}`);
  }

  params.push(`w=${w}`);

  if (h) {
    params.push(`h=${h}`);
  }

  params.push(`q=${QUALITY}`, `fit=${h ? "crop" : "max"}`, "auto=format");

  return `${url}?${params.join("&")}`;
}

function croppedSize(image: SanityImageValue, url: string) {
  const source = cdnSize(url);
  const size = imageSize(image);

  return source && size ? { source, ...size } : undefined;
}

/**
 * The image for `<Image>`, or `null` for an empty field, a projection that
 * did not dereference the asset, or a URL off Sanity's CDN.
 *
 *   <Image src={sanityImage(data.image)} sizes={HERO} />
 */
export function sanityImage<T extends SanityImageValue | null | undefined>(
  value: T
): SanityImageSource<T> | null {
  const image: SanityImageValue | null | undefined = value;
  const url = image?.asset?.url;

  if (!image || !url) {
    return null;
  }

  const size = croppedSize(image, url);

  if (!size) {
    return null;
  }

  const { width, height, source } = size;
  const src: string = url;
  const field: SanityImageValue = image;
  const aspectRatio = width / height;
  const placeholder = image.asset?.metadata?.lqip ?? "";
  const alt = image.alt ?? "";
  const base = { sources: [], width, height, aspectRatio, placeholder, alt };

  function at(w: number) {
    return cdnUrl(src, field, source, w);
  }

  const svg = isSvg(url);

  function build(sizes: string): SanityImageAttributes {
    // An SVG scales on its own.
    if (svg) {
      return { ...base, src, srcset: "", widths: [] };
    }

    // Widths `sizes` can pick, capped at the source (+5% slack); the source
    // width is added when a step was cut.
    const picked = selectWidths([...WIDTHS], [sizes]) ?? [...WIDTHS];
    const widths = picked.filter((w) => w <= width * 1.05);

    if (widths.length < picked.length && (widths.at(-1) ?? 0) < width) {
      widths.push(width);
    }

    const largest = widths.at(-1);

    if (largest === undefined) {
      throw new Error("[@visio/sanity] sanityImage() picked no width.");
    }

    return {
      ...base,
      src: at(largest),
      srcset: widths.map((w) => `${at(w)} ${w}w`).join(", "),
      widths,
    };
  }

  // The size on the source itself, for a box that takes the image's ratio.
  // SAFETY: the alt type of SanityImageSource<T> follows T, which TypeScript cannot pick at runtime.
  return Object.assign(build, {
    width,
    height,
    aspectRatio,
  }) as SanityImageSource<T>;
}

/** One URL at a fixed size, such as a background or a poster. With a height the CDN crops around the editor's hotspot. */
export function sanityImageUrl(
  image: SanityImageValue | null | undefined,
  size: { width: number; height?: number }
): string | undefined {
  const url = image?.asset?.url;

  if (!image || !url) {
    return undefined;
  }

  const source = cdnSize(url);

  if (isSvg(url) || !source) {
    return url;
  }

  return cdnUrl(url, image, source, size.width, size.height);
}

const SHARE = { width: 1200, height: 630 };

/** The social image for a page's `meta`, or `undefined`, so a fallback follows with `??`. */
export function shareImage(
  image: SanityImageValue | null | undefined
): MetaImage | undefined {
  const url = image?.asset?.url;
  const source = url ? cdnSize(url) : undefined;

  // Link previews do not show an SVG.
  if (!image || !url || isSvg(url) || !source) {
    return undefined;
  }

  // In draft mode the alt carries stega marks, which the head would show in link previews.
  const alt = stegaClean(image.alt) || undefined;

  return {
    url: cdnUrl(url, image, source, SHARE.width, SHARE.height),
    ...SHARE,
    ...(alt && { alt }),
  };
}
