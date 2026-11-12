import { isDev } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { watchSizes } from "./check.ts";
import { fitSizes } from "./fit.ts";
import type {
  DescribedImageSource,
  ImageSource,
  ResponsiveImage,
  VectorImage,
} from "./types.ts";

// The local image last: TypeScript reports a mismatch against the last member,
// so a local image without `alt` is told that `alt` is missing.
export type ImageProps = (
  | {
      /** A CMS image with an alt field. Nothing renders for `null`, an empty field. */
      src: DescribedImageSource | null | undefined;
      /** Overrides the editor's alt text. */
      alt?: string;
      /** From `sizes()` in `@visio/styling`. */
      sizes: string;
    }
  | {
      /** A `.svg?responsive` import or a `remoteImage()`: one file at every width. */
      src: VectorImage | null | undefined;
      alt: string;
      sizes?: undefined;
    }
  | {
      /** A `?responsive` import, or a CMS image without an alt field (`null` renders nothing). */
      src: ImageSource | null | undefined;
      alt: string;
      /** From `sizes()` in `@visio/styling`. */
      sizes: string;
    }
) & {
  /** How the image meets a box of another ratio. Default `cover`; logos want `contain`. */
  fit?: "cover" | "contain";
  /** The blurred preview while it loads. Default true. */
  placeholder?: boolean;
  /** The LCP image: fetch eagerly with high priority. */
  preload?: boolean;
  /** `eager` for an image hidden now and shown soon, such as the next slide; `preload` is eager too. Default `lazy`. */
  loading?: "eager" | "lazy";
  /** On the `<picture>`, the box the image fills. */
  class?: JSX.HTMLAttributes<HTMLPictureElement>["class"];
  /** The `<img>`, for a WebGL texture of the file the browser picked. */
  imgRef?: (img: HTMLImageElement) => void;
  /** `anonymous` on an image from another origin that a texture draws, so WebGL reuses this download. */
  crossorigin?: "anonymous" | "use-credentials";
};

export function Image(props: ImageProps) {
  function image(): (ResponsiveImage & { alt?: string }) | null | undefined {
    if (typeof props.src !== "function") {
      return props.src;
    }

    if (props.sizes === undefined) {
      throw new Error(
        "[@visio/image-optimizer] <Image> got a CMS image without sizes."
      );
    }

    return props.src(props.sizes);
  }

  function fit() {
    return props.fit ?? "cover";
  }

  function sized(img: ResponsiveImage) {
    return props.sizes && fitSizes(props.sizes, fit(), img.width / img.height);
  }

  return (
    <Show when={image()}>
      {(img) => (
        <picture class={props.class}>
          <For each={img().sources}>
            {(source) => (
              <source
                type={source.type}
                srcset={source.srcset}
                sizes={sized(img())}
              />
            )}
          </For>
          <img
            ref={(el) => {
              props.imgRef?.(el);

              // The check reads the image after it loads, outside the owner.
              if (isDev) {
                watchSizes(
                  el,
                  fit,
                  () => img().width / img().height,
                  () => props.sizes?.includes("/") ?? false
                );
              }
            }}
            crossorigin={props.crossorigin}
            src={img().src}
            srcset={img().srcset || undefined}
            sizes={img().srcset ? sized(img()) : undefined}
            width={img().width || undefined}
            height={img().height || undefined}
            alt={props.alt ?? img().alt ?? ""}
            loading={props.preload ? "eager" : (props.loading ?? "lazy")}
            fetchpriority={props.preload ? "high" : "auto"}
            decoding="async"
            draggable="false"
            data-fit={props.fit === "contain" ? "contain" : undefined}
            style={{
              "background-image":
                props.placeholder === false || !img().placeholder
                  ? undefined
                  : `url("${img().placeholder}")`,
            }}
          />
        </picture>
      )}
    </Show>
  );
}
