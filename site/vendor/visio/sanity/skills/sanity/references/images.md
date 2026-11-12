# Images

```tsx
const HERO = sizes({ mobile: columns(4), desktop: columns(6) });

<Image src={sanityImage(data.hero.image)} sizes={HERO} preload />;
```

- The same props as a local image; only `src` differs. `alt` defaults to the image's `alt` field and is optional only when the value has one; a field without (a logo) takes `alt` at the call site. Give every content image an `alt` field in the schema.
- A box that takes the image's ratio reads it off the source: `sanityImage(value)?.aspectRatio`. `<Image>` calls the source with its `sizes`, so the `srcset` offers only the widths that value can make the browser pick.
- An empty field gives `null`, and `<Image>` renders nothing. No `<Show>` is needed.
- A component that takes images from more than one query types its prop as the union of those image fields (`NonNullable<A_QUERY_RESULT>['hero']['image'] | NonNullable<B_QUERY_RESULT>['logo']`). Then `alt` is required when one of them has no `alt` field. Do not type an `<Image>` prop as `SanityImageValue`: it makes `alt` optional, so a logo without an `alt` field renders with no alt. Use `SanityImageValue` from `@visio/sanity` only where no `<Image>` renders the value, for example a helper that calls `sanityImageUrl()`.
- `preload` only on the one image above the fold.
- Logos: `fit="contain"` and `placeholder={false}`.
- The social image of a page: `shareImage(value)`. It gives the `MetaImage` for `meta`: 1200 by 630, cropped around the hotspot, with the image's `alt`, stega marks removed. It gives `undefined` for an empty field, an SVG (link previews do not show one) or a URL off Sanity's CDN, so chain a fallback with `??`.
- Not an `<img>` and not the social image (a background, a poster): `sanityImageUrl(value, { width, height })`. With a height, the CDN crops to that shape.
- The size of an image in the site: `sanityImage(value)?.width` and `?.height`, after the editor's crop.
- The size of an image in a Studio validation rule: `imageSize(value)` from `@visio/sanity/studio/schema` gives `{ width, height }` after the editor's crop, or `undefined`. It reads the asset id (`image-<hash>-1200x630-jpg`) of the reference, without a fetch. The helper only reads; the limits are the site's. It is the one visio entry a schema file may import (typegen loads these files outside the Studio):

  ```ts
  // studio/schemaTypes/seo.ts
  import { imageSize } from "@visio/sanity/studio/schema";

  defineField({
    name: "image",
    type: "image",
    validation: (rule) =>
      rule.custom((value) =>
        (imageSize(value)?.width ?? 1200) < 1200
          ? "Use an image at least 1200 px wide."
          : true
      ),
  });
  ```
