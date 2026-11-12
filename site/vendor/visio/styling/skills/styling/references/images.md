# Images

`sizes()` turns the width an image gets in the layout into the `sizes` attribute, so the browser fetches the `srcset` candidate the fluid system will render. It takes what you would write in `css()`: `dp(n)`, `columns(n)`, `t.layout.col`, a design px number, or a fixed `'320px'`, once or per screen. A single value applies to every screen, so a single `columns(n)` must fit the grid of every screen: `sizes(columns(12))` on a 4-column phone is a compile error (`SIZES_NEEDS_WIDTH`), because the browser would fetch a file three screens wide. Write `{ mobile: columns(4), desktop: columns(12) }`. With `fluid: false` a fixed width is written in px and a column span as a share of the window. A box whose height decides the image's width (a photo viewer with `fit="contain"`, a full-screen box with `cover`) also gives its height, the value its `css()` height has: ``sizes(dp(1200), { height: `calc(100svh - ${dp(144)})` })``. `dp()` and `dph()` in it become `vw` and `vh` per screen. Anything but `dp(n)`, `dph(n)`, px, the viewport height units, and `calc()`, `min()` or `max()` of them is a compile error (`SIZES_HEIGHT_UNREADABLE`), and so is a height per screen without `mobile`. The compiled entry is `width / height`, which only `<Image>` reads: it puts in the image's ratio (the `images` skill).

```tsx
import { Image } from "@visio/image-optimizer";
import { columns, sizes } from "@visio/styling";

import photo from "../assets/images/photo.jpg?responsive";

const PHOTO_SIZES = sizes({ mobile: columns(4), desktop: columns(6) });
// '(min-width: 800px) min(48.33vw, 609px), 91.47vw' with this project's tokens

<Image src={photo} alt="..." sizes={PHOTO_SIZES} />;
```

Below the desktop breakpoint the value is the share of the viewport; above it the share is capped at the px the `layout.maxWidth` freezes it to. The clauses start at the widest screen and use `min-width` at the stylesheet's breakpoints; the narrowest screen is the last value, with no condition. The plugin compiles the call to that string, like `css()`, so the argument has to be static: the helpers, tokens, numbers, or a top-level const of the file. It works anywhere in the file, in a const or straight in the `sizes` attribute. Put the import and the element in the same file: the compiler passes the element's `sizes` on to the import, and the optimizer then skips widths the browser can never pick for it. An image passed around as a prop keeps every width, and the report says so (`RESPONSIVE_NEEDS_SIZES`). `<Image>` from `@visio/image-optimizer` renders the `<picture>` for a `?responsive` import. SVG logos and icons are `*.svg?component` imports from the same package: inline Solid components with the props spread onto the root, coloured by `currentColor` in the file; never paste SVG markup into JSX.
