---
name: images
description: How images and SVGs get into a visio site - ?responsive imports encoded at build time, sizes() from the layout, preload, fit and placeholder, CMS images through the same component, ?component SVGs for logos and icons, ?responsive SVGs for drawings, and ?defs for a filter or gradient that CSS references. Read before adding or changing any image, logo, or icon.
---

# @visio/image-optimizer

Design and rationale: `image-optimizer/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```tsx
import { Image } from '@visio/image-optimizer';
import { columns, sizes } from '@visio/styling';
import photo from '../assets/images/photo.jpg?responsive';
import Mark from '../assets/mark.svg?component';

const PHOTO_SIZES = sizes({ mobile: columns(4), desktop: columns(6) });

<Image src={photo} alt="…" sizes={PHOTO_SIZES} preload />
<Mark class={s.mark} aria-hidden="true" />
```

- **Never a raw `<img>`.** Import the file with `?responsive` and render it with `<Image>` from `@visio/image-optimizer`, an `.svg` too. The import is a `<picture>`'s worth of WebP and original variants plus a blurred placeholder, encoded at build time.
- **`sizes` is the width the layout gives the image**, written with `sizes()` from `@visio/styling`, static, and in the same file as the import. Write `columns(n)` per screen when the screens have different grids (`sizes(columns(12))` on a 4-column phone is a compile error). The compiler hands the value to the import, and the optimizer only encodes widths that value can make the browser fetch. An import that reaches no such element keeps every width and is a report finding, `RESPONSIVE_NEEDS_SIZES`; silence a deliberate one with `// visio-ignore RESPONSIVE_NEEDS_SIZES: reason` above the import.
- **A box whose height decides the image's width** also gives `sizes()` its height: ``sizes({ mobile: dp(375), desktop: dp(1200) }, { height: `calc(100svh - ${dp(144)})` })``, with the value the box's `css()` height has (`dp(n)`, `dph(n)`, `'320px'`, `'100svh'`, or `calc()` of them). There are three such boxes: a photo viewer or lightbox with `fit="contain"`, which shows a portrait photo narrower than the box; a strip of a fixed height with `contain`; and a full-screen or tall box with `cover`, which shows a landscape photo wider than the box. `<Image>` puts in the image's own ratio, so it works for a CMS image too. Every other image gives the width alone. In dev, `<Image>` warns once per image when its `sizes` makes the browser pick another file than the width the image shows needs (`[@visio/image-optimizer] <Image> … shows 570 px wide, but its sizes plans for 1029 px`), and the smoke run reports it. The warning says whether the fix is the height or the width per screen. Do not add `height` without that warning or one of those boxes.
- `preload` on the one image above the fold, and on no other. An image that is hidden now and shown soon, such as the next slide of a slideshow, takes `loading="eager"`: it loads at once at normal priority, so it has no blur when it fades in. Never use `preload` for that, which also raises its priority over the LCP image.
- Inside a box with its own aspect ratio pass `fit="cover"` (the default) or `fit="contain"` for logos. Pass `placeholder={false}` on a transparent image, where the blur would show through.
- **Images from a CMS** go through its CDN and render with the same component and props: `<Image src={sanityImage(value)} sizes={…} />` with `sanityImage` from `@visio/sanity` (the sanity skill).
- **An image at a URL the site does not own** (a YouTube poster, a feed's media): `<Image src={remoteImage(url, { aspectRatio: 16 / 9 })} alt="…" />` with `remoteImage` from `@visio/image-optimizer`, no `sizes`. It loads the one file as it is, with no `srcset` and no blur. Leave `aspectRatio` out when a class gives the box its ratio. Never build a `ResponsiveImage` by hand. A file in the repo is still a `?responsive` import.
- **An image from another origin that WebGL draws** (a CMS photo under a shader) takes `crossorigin="anonymous"` with its `imgRef`, so the texture reads the same download. Leave it off every other image: a CDN without CORS headers then fails to load the image at all.
- **Logos and icons are SVG, never pasted into JSX.** `?component` is a Solid component that renders the file inline with the props spread onto the root, so a class sizes and colours it like any element. A one-colour icon or logo has `fill="currentColor"` (or `stroke`) in the file itself, so it takes the CSS `color` wherever it is imported. A file from a design tool comes with a hex colour: replace it in the file once. Ids are prefixed per file, so two inline SVGs never capture each other's gradient; a mark with no authored size is `1em` tall before the stylesheet lands.
- **A filter, gradient or mask that CSS references is `x.svg?defs`**: `filter: url(#no-white)` needs the `<filter>` on the page. Put the defs in a file, `import Filters from '../assets/filters.svg?defs'`, and render `<Filters />` once, in the layout. The ids stay as written, so CSS names them as they are in the file. Reference them from CSS, never from an attribute in a `?component` file: its prefix rewrites that reference too. A file with no id stops the build; two `?defs` files with one id give a warning.
- **A large drawing is `x.svg?responsive`**: one optimized file with the size of its viewBox. Render it with `<Image src={drawing} alt="" />`, with no `sizes`, because one file serves every width. It loads lazily and keeps its box before it loads. `class` goes on the `<picture>`, which the reset stretches to fill its box (`height: 100%`), so a class that sizes the drawing by `aspectRatio` alone stretches in a grid or flex cell, and `cover` crops it: add `height: 'auto'`. A drawing that was a raw `<img>` needs this, because the reset gave that `<img>` `height: auto`. The import is a value, so a list of drawings or a drawing passed as a prop works. A drawing whose parts move is one file per part, each rendered in its own box over the others, never one inline SVG with animated groups (the `animate` skill). A plain `.svg` import is the file's URL, for CSS or a meta tag, never for an `<img>`.
- `images()` and `svg()` take no options. `visio()` adds both. The widths, the quality and the SVGO settings are fixed; `sizes` is the one control.
- A build encodes an image once and keeps the files in `node_modules/.vite/visio-images`, which Vercel restores between deploys. It logs `N image files: X from the cache, Y encoded`; `Y` above 0 when no image changed means the cache was lost, Bun was upgraded, or a visio update changed the encode settings.
- **The favicon and the touch icons are not images in a page.** Their artwork goes in `src/icons/`, and the build writes the files and links them. The `visio` skill has the rules.
