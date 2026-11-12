---
name: animate
description: How animation works with @visio/animate - anime.js, the one animation library, already stepped on the frame loop from its first import; what may import it, CSS for a state change, the easings from the tokens, animate() or waapi.animate(), splitText for lines, words and characters, and why a moving part of a drawing is its own box. Read before adding anything that animates or loads anime.js.
---

# @visio/animate

anime.js on the frame loop, and text split into the lines the browser painted. Design and rationale: `animate/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```tsx
import { animate, stagger } from "@visio/animate";

import { EASE_OUT } from "../lib/motion";

animate(items, {
  opacity: [0, 1],
  y: [20, 0],
  delay: stagger(60),
  ease: EASE_OUT,
});
```

- **anime.js is the animation library, from `@visio/animate`.** It is the anime.js API (`animate`, `createTimeline`, `stagger`, `utils`, `cubicBezier`, ...) but its text splitter, and its first import puts anime.js on the loop at `ORDER.animation`. There is nothing to call. Never import `animejs` itself; lint bans it in the site and the lab. Its `engine` keeps `defaults` and `timeUnit`, but not the loop.
- **Pages and their components import it, never the shell** (the app root, the nav, the footer, `ui/`). A page transition is the `transitions` skill.
- **Easings come from the tokens**: `easing(t.easings.out)` from `@visio/animate` turns a `cubic-bezier(...)` token into the curve, once, in `src/lib/motion.ts` (`EASE_OUT`, `EASE_IN_OUT`), so a tween and a CSS transition follow one curve. Shared presets live there too.
- **CSS for a state change, anime.js for scripted motion.** A hover, a focus ring, an open menu, the nav that dims: a CSS transition in the styles, which the styling compiler checks. A sequence, a stagger, a timeline, a page transition, anything that reads the scroll or JS values: anime.js. No other animation library (GSAP, Motion, React Spring and the rest).
- Animate `transform`, `opacity`, `clip-path` and registered variables only, as the styling compiler requires.
- **`animate()` or `waapi.animate()`.** `animate()` steps on the frame loop, on the main thread, every frame. Use it for anything that reads the scroll or a JS value, a timeline, a callback per frame (`onUpdate`), and an element that a WebGL object follows, which has to be where the renderer draws it in this frame. `waapi.animate()` builds a Web Animations API animation: it is off the frame loop and runs no JS per frame, and on a page where nothing else moves the loop sleeps, so the browser runs it on the compositor without main-thread frames. Use it for a loop or a tween of DOM elements whose values are known when it starts, such as a part of a drawing that sways. Its parameters are a subset: no `onUpdate`, `onBegin`, `onLoop` or `modifier` (only `onComplete`), DOM targets only, and an easing function becomes a CSS `linear()`. It returns `play`, `pause`, `cancel` and `revert`, as `animate()` does.
- **What moves is its own box.** Animate an element that holds its content, a `<div>` around an `<Image>`, never a `<g>` or a path inside an inline SVG: the browser lays out and paints the whole SVG again on every frame. A drawing whose parts move is one `?responsive` file per part, each in its own box (the `images` skill). When a part moves outside the box that clips it (a light sweep translated past the drawing's edge), give that box `overflow: 'clip'` too: `clip-path` hides the part but does not clip overflow, so the part still widens the page's scroll area.
- **A component's animations go in `useAnime(root, constructor, options)`.** It runs the constructor in an anime.js scope (`createScope`) on the root once the component settles, in the browser only, and reverts the scope with the owner. A selector in the constructor resolves inside the root, so a part is a data attribute (`animate('[data-part]', ...)`), not an array of refs. `scope.matches.reduceMotion` is true when the visitor asks for less motion; return early and the elements stay at rest. A change of that query reverts the scope and runs the constructor again. `inView: true` (or `IntersectionObserver` options) pauses the scope's running animations while the root is off screen and plays them again when it is back: an endless animation costs main-thread time out of view too. An animation with `autoplay: false` or linked to the scroll is left alone. An intro that must play once keeps a flag and returns on a second run. Keep the constructor light: all constructors on a page run in one task when the components settle, so work that parses or clones markup belongs at build time (the `images` skill), not in the constructor. The rest of the options are anime.js's own `createScope` options (`defaults`, `mediaQueries`).

```tsx
useAnime(
  () => arc,
  (scope) => {
    if (scope.matches.reduceMotion) return;
    waapi.animate("[data-ring]", {
      rotate: [-5, 5],
      duration: 5500,
      alternate: true,
      loop: true,
    });
  },
  { inView: true }
);
```

- **One timeline belongs to one `useAnime`, the parent's.** Its constructor builds the whole timeline, and a selector reaches the children's parts too (`tl.add('[data-line]', ...)`): it resolves inside the root, the children's markup included. A child never adds to a parent's timeline. Solid settles a parent before its children, so the parent's constructor runs first, and a child's `add()` then lands on a timeline that is already playing.
- **Split text with `splitText(target, options, effect)` from `@visio/animate`, in the constructor.** It splits the target into the lines the browser painted (kugiri), and words and characters inside them, then runs `effect` with the split. `options` are kugiri's: `type` (`["lines"]`, `["words"]`, `["chars"]`, lines always come with the others), `mask` (a clipping wrapper to slide out from under), `ignore` and `classes`. The lines exist in the call. The effect runs again when the target's width changes and when a font loads, and what it returns (the animation, or a cleanup function) is reverted first. A returned animation starts the next split at the time the last one had, so a reveal does not play again. The effect runs in the scope, so `inView` and `defaults` apply. The scope reverts the split with the component. Never import `kugiri` or anime.js's `split`; lint bans the first, and the second is not in `@visio/animate`.
- **Split text that does not change while it is mounted.** Each new split (after a resize or a font load) writes the target's markup back as new nodes, so a signal that changes text inside it writes to a node that is gone, and an event handler inside it stops firing; it works until the first resize, which makes the bug easy to miss. The dev server warns `SPLIT_HAS_HANDLERS`. Text from `props.data` is fine, because the page mounts again on a navigation. A link inside still navigates. Every unit has `data-line`, `data-word` or `data-char` and its index as `--line`, `--word` or `--char`.

```tsx
useAnime(
  () => root,
  (scope) => {
    if (scope.matches.reduceMotion) return;
    splitText("[data-title]", { type: ["lines"], mask: "lines" }, (split) =>
      animate(split.lines, {
        y: ["100%", 0],
        delay: stagger(80),
      })
    );
  },
  { inView: true }
);
```

- A `<video>` or anything else with `play()` and `pause()` that is not anime.js plays on screen with `usePlayInView` from `@visio/frame` (the `frame` skill).
- Per-frame work that is not a tween (a readout, a value from the scroll) is `useFrame` from `@visio/frame` (the `frame` skill).
