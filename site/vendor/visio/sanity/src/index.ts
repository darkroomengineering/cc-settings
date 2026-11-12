// The browser-safe entry. The client is `@visio/sanity/server`.
export { defineQuery } from "./query.ts";

export { TRANSLATIONS, translationParams } from "./translations.ts";

export { localize, type Localized } from "./locale.ts";

export {
  type SanityImageValue,
  sanityImage,
  sanityImageUrl,
  shareImage,
} from "./image.ts";

export {
  PortableText,
  type PortableTextBlock,
  type PortableTextComponents,
  type PortableTextMarkProps,
  type PortableTextProps,
  type PortableTextTypeProps,
  type PortableTextValue,
} from "./portable-text.tsx";

export { VisualEditing } from "./visual-editing.tsx";

export type { VisualEditingProps } from "./visual-editing.tsx";

export { stegaClean } from "@sanity/client/stega";
