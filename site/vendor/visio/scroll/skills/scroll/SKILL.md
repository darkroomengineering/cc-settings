---
name: scroll
description: How scrolling works with @visio/scroll - optional Lenis on the frame loop, scrollTo() and lockScroll() that work with or without it, lenis() for the scroll position, anchors, modals and nested scrollers. Read before adding anything that reads the scroll or scrolls programmatically. Per-frame work is the frame skill.
---

# @visio/scroll

Smooth scrolling (Lenis) for the whole site, stepped in the first slot of the frame loop of `@visio/frame`, and the helpers that scroll and lock the page with Lenis or without it. Per-frame work and the slots are the `frame` skill, anime.js the `animate` skill. Design and rationale: `scroll/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```tsx
import { ORDER, useFrame } from "@visio/frame";
import { lenis, lockScroll, scrollTo, SmoothScroll } from "@visio/scroll";

// optional: once, in app.tsx, inside the router
<SmoothScroll />;

// the same calls with Lenis or without it
scrollTo("#contact");
scrollTo(section, { offset: -80 });
// a modal: one lock while it is open, released on close and on unmount
let release: (() => void) | undefined;
function open() {
  release ??= lockScroll();
}
function close() {
  release?.();
  release = undefined;
}
onSettled(() => close);

// in a component: read the scroll from the loop; false lets the loop sleep when the page is still
useFrame(
  () => {
    const l = lenis();
    if (l) setProgress(l.progress);
    return false;
  },
  { order: ORDER.animation, label: "progress bar" }
);
```

- **`<SmoothScroll />` is optional.** Leave it out to keep the native scroll; no other code changes. A WebGL canvas fixed over the viewport that draws objects over page elements needs it: such an object trails a native scroll by a frame. A canvas inside its section moves with the page and needs no Lenis (the `frame` skill, `references/webgl.md`).
- **`<SmoothScroll />` takes the feel of the glide only:** `lerp`, `duration`, `easing` and `wheelMultiplier`. Never import `lenis` directly; lint bans it in the site and the lab.
- **Scroll with `scrollTo(target, { offset, immediate })`**, never `lenis()?.scrollTo`, `window.scrollTo` or `scrollIntoView({ behavior: 'smooth' })`. It glides with Lenis when it runs, natively otherwise, and jumps under reduced motion. Lint (`visio/no-native-scroll`) fails on the native calls in the site and the lab. The target is a pixel offset, a selector, or an `HTMLElement`; an element lands at its top less its `scroll-margin-top` and the root's `scroll-padding-top`, and `'top'`, `'bottom'` and `'#top'` are the page's ends, with Lenis or without it. An SVG element is a type error, because Lenis reads its `x` and `y` as a position ([#551](https://github.com/darkroomengineering/lenis/issues/551)): keep a ref to the HTML element around it, or narrow `el.children[i]` with `instanceof HTMLElement`.
- **A modal or a menu calls `lockScroll()`** when it opens, and calls the release it returned when it closes and in the cleanup of `onSettled`, never `lenis()?.lock()` or an `overflow` of its own. It hides the overflow of `html`, which stops the wheel, touch, the keyboard and the scrollbar, with Lenis or without it, and keeps the scrollbar's width so the page does not shift. The page scrolls again when every lock is released. A release releases only its own lock, and a second call of it does nothing, so a menu's lock survives a modal that closes and then unmounts. The lab cases `/scroll/modal` and `/scroll/native` show it.
- **`lenis()` is the instance**, a module-scope signal, undefined on the server, without `<SmoothScroll />`, and before it mounts. Read `scroll`, `velocity` and `progress` inside a frame callback that returns `false`, not in an effect: it runs on every frame of a glide and once for each native scroll, and the loop sleeps while the page is still. Without Lenis, read `window.scrollY` in a `scroll` listener.
- **How far an element is through the viewport is `useScrollProgress(() => el, { start, end })`**, an accessor from 0 to 1, never a `getBoundingClientRect()` loop of your own. `start` and `end` are a line of the element, then a line of the viewport (`top`, `center` or `bottom`); the default runs from `top bottom` (its top enters at the bottom) to `bottom top` (its bottom leaves at the top). It follows Lenis frame by frame, the native scroll, the scroll of a nested scroller and a change of the page's height, and lets the loop sleep while the page is still. Put the value on a registered variable through the `style` prop (`cssVars()`, the styling skill). A tween that scrubs with the scroll is anime.js's `onScroll` (the animate skill).
- **A nested scroller** (a list, a code block) is marked `data-lenis-prevent` (or `-wheel`, `-touch`), so the wheel scrolls it and not the page under Lenis. Without Lenis the attribute does nothing; leave it out.
- **Hash links** to a section of the same page glide on their own under Lenis. Without it, and to another page, the router jumps to the target. Nothing to wire.
- Never set `scroll-behavior: smooth` on `html`: the router's reset has to land in one step. Reduced motion is respected: the scroll tracks the input 1:1 and programmatic scrolls jump.
