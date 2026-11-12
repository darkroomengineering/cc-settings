/** Encoded formats the optimizer writes. `jpeg` and `png` only as the original. */
export type ImageFormat = "webp" | "jpeg" | "png";

export interface ImageOptions {
  /** Directory for the content-addressed cache. */
  cacheDir: string;
  /** Base for variant file names, usually the source file name without extension. */
  name: string;
  /** Output widths in px. Widths above the source become the source's width, never upscaled. */
  widths?: number[];
  /** Emit a blurred inline SVG placeholder. Default true. */
  placeholder?: boolean;
  /** Gets the name of every cache file the image reads or writes. */
  used?: Set<string>;
}

export interface ImageVariant {
  width: number;
  height: number;
  format: ImageFormat;
  bytes: Uint8Array;
  /** `<name>-<hash8>-<width>w.<ext>`; the bundler adds its own hash. */
  name: string;
  cached: boolean;
}

export interface OptimizedImage {
  /** Source dimensions after EXIF rotation. */
  width: number;
  height: number;
  aspectRatio: number;
  /** The source's own format, the `<img>` fallback. */
  format: ImageFormat;
  /** Every width in WebP, then in the source's own format unless that is WebP. */
  variants: ImageVariant[];
  /** Widths actually produced, ascending. */
  widths: number[];
  /** `data:image/svg+xml,...` blurred placeholder, URL-encoded, when enabled. */
  placeholder?: string;
}

/** One `<source>` of a `<picture>`. */
export interface ResponsiveSource {
  /** MIME type, e.g. `image/webp`. */
  type: string;
  srcset: string;
}

/** What a `*.jpg?responsive` import resolves to. */
export interface ResponsiveImage {
  /** Largest variant in the source's own format, the `<img src>` fallback. */
  src: string;
  /** Every width in the format of `src`, for `<img srcset>`. */
  srcset: string;
  /** The WebP variants, for a `<source>`; empty when the source is WebP. */
  sources: ResponsiveSource[];
  width: number;
  height: number;
  aspectRatio: number;
  widths: number[];
  /** Data URI for a blurred background while the image loads. Empty when disabled. */
  placeholder: string;
}

/** What a `*.svg?responsive` import resolves to: one file at any width, so no `sizes`. */
export interface VectorImage extends ResponsiveImage {
  srcset: "";
  sources: [];
}

/** What `remoteImage()` returns: one file at a URL the build does not encode, so no `sizes`. */
export interface RemoteImage extends VectorImage {
  widths: [];
  placeholder: "";
}

/** What a source knows before it is given `sizes`, so a box can take its ratio. */
export interface ImageSize {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * An image a CDN resizes on request (`sanityImage()` from `@visio/sanity`): a
 * function that builds a `ResponsiveImage` for the component's `sizes`.
 */
export type CdnImageSource = ((sizes: string) => ResponsiveImage) & ImageSize;

/** A `CdnImageSource` that carries the editor's alt text, so the component needs no `alt`. */
export type DescribedImageSource = ((
  sizes: string
) => ResponsiveImage & { alt: string }) &
  ImageSize;

/** What an image component takes: a `?responsive` import, or an image a CDN resizes. */
export type ImageSource = ResponsiveImage | CdnImageSource;
