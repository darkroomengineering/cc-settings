import type { RemoteImage } from "./types.ts";

export interface RemoteImageOptions {
  /** Width over height. Leave it out when a class gives the box its ratio. */
  aspectRatio?: number;
}

export function remoteImage(
  url: string,
  options: RemoteImageOptions = {}
): RemoteImage {
  const { aspectRatio } = options;

  if (
    aspectRatio !== undefined &&
    !(aspectRatio > 0 && Number.isFinite(aspectRatio))
  ) {
    throw new Error(
      `[@visio/image-optimizer] remoteImage() needs an aspectRatio above 0, got ${aspectRatio}.`
    );
  }

  const height = aspectRatio ? 1000 : 0;

  return {
    src: url,
    srcset: "",
    sources: [],
    width: Math.round(height * (aspectRatio ?? 0)),
    height,
    aspectRatio: aspectRatio ?? 0,
    widths: [],
    placeholder: "",
  };
}
