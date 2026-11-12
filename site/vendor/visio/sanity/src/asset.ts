/** An image field as a query projects it (`asset->{ url }`) or as the Studio holds it (`asset._ref`). */
export interface ImageAssetValue {
  asset?: {
    _ref?: string | null;
    _id?: string | null;
    url?: string | null;
  } | null;
  crop?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

/** `image-<hash>-<w>x<h>-<ext>`, the id of every image asset. */
const ASSET_ID = /^image-[^-]+-(?<width>\d+)x(?<height>\d+)-[a-z0-9]+$/u;

/** `https://cdn.sanity.io/images/<project>/<dataset>/<asset>-<w>x<h>.<ext>` */
const CDN_URL =
  /^https?:\/\/[^/]+\/images\/[^/]+\/[^/]+\/[^/?#]+-(?<width>\d+)x(?<height>\d+)\.[a-z]+$/u;

function sizeOf(match: RegExpExecArray | null): Size | undefined {
  const groups = match?.groups;

  return groups
    ? { width: Number(groups.width), height: Number(groups.height) }
    : undefined;
}

/** The asset's own size, which Sanity writes into the file name of every CDN URL. */
export function cdnSize(url: string): Size | undefined {
  return sizeOf(CDN_URL.exec(url));
}

export function isSvg(url: string): boolean {
  return url.endsWith(".svg") || url.endsWith("-svg");
}

/** The editor's crop in source px; the whole image without one. */
export function cropRect(image: ImageAssetValue, size: Size): Rect {
  const { top = 0, bottom = 0, left = 0, right = 0 } = image.crop ?? {};
  const x = Math.round(left * size.width);
  const y = Math.round(top * size.height);

  return {
    left: x,
    top: y,
    width: Math.round(size.width - right * size.width - x),
    height: Math.round(size.height - bottom * size.height - y),
  };
}

/** The image's size after the editor's crop, read from the asset id or URL without a fetch. */
export function imageSize(
  value: ImageAssetValue | null | undefined
): Size | undefined {
  const asset = value?.asset;

  if (!value || !asset) {
    return undefined;
  }

  for (const name of [asset._ref, asset._id, asset.url]) {
    const size = name
      ? (sizeOf(ASSET_ID.exec(name)) ?? cdnSize(name))
      : undefined;

    if (!name || !size) {
      continue;
    }

    // The CDN serves an SVG uncropped.
    if (isSvg(name)) {
      return size;
    }

    const { width, height } = cropRect(value, size);

    return { width, height };
  }

  return undefined;
}
