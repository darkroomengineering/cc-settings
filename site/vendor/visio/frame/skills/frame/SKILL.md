---
name: frame
description: How per-frame work goes through @visio/frame - one tempus loop with fixed slots (scroll, animation, render), useFrame in a component, frame() outside one, an fps that keeps its slot, and what a project's own WebGL renderer must handle (references/webgl.md). Read before adding anything that runs every frame, a shader, a canvas or a 3D scene. Animation with anime.js is the animate skill.
---

# @visio/frame

One frame loop (tempus) for the whole site. Design and rationale: `frame/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```tsx
import { ORDER, useFrame } from "@visio/frame";

// in a component: runs every frame while it is mounted
useFrame(({ time }) => setTurn(Math.round(time / 100) % 36), {
  order: ORDER.animation,
  label: "spinner",
});
```

- **Never a loop of your own.** No `requestAnimationFrame`, no library's default loop. Per-frame work is `useFrame(cb, { order, fps, label })` in a component, `frame(cb, options)` outside one (it returns the unsubscribe and does nothing on the server).
- **Pick the slot by what the callback does.** Each frame runs `ORDER.scroll` (Lenis), then `ORDER.animation` (anime.js, anything that reads the scroll), then `ORDER.render` (a WebGL renderer, anything that draws). WebGL is the project's own code, the smallest that does what the design draws: read [references/webgl.md](references/webgl.md) before you write one. A callback at `animation` reads this frame's scroll.
- **Never move an element each frame to follow the scroll.** A header that rides a hero's edge, an element that sticks or pins: use `position: sticky` (a negative `top` for an offset) or another CSS layout, never `getBoundingClientRect()` and a `translate` in a frame callback. A native scroll moves the page on the browser's own thread, so the callback is one frame late and the element shakes; Safari's overdrag (rubber-band) and momentum show it most. This holds with `<SmoothScroll />` too: Lenis leaves touch scrolling and overdrag native. CSS moves with the page. A callback may still change state at a scroll threshold (a color, a class), where one frame late does not show. A WebGL object has no CSS layout, so the rule is not for it ([references/webgl.md](references/webgl.md)).
- **`fps` keeps the slot.** `{ fps: 30 }` throttles the callback, which still runs in its slot; its `deltaTime` is the time since its own last run. `order` takes an `ORDER` slot only (default `ORDER.animation`).
- **The loop sleeps when nothing needs a frame.** Every frame on the main thread makes Chrome tick the page's WAAPI and CSS animations there too, so the loop asks for one only while a callback needs it. A callback returns `false` when it needs no next frame of its own: one that only reads what others move (the scroll, an anime.js value) runs on every frame they ask for and lets the loop sleep after. A callback that returns nothing keeps the loop running while it is mounted. `wake()` runs the loop again from the next frame: call it from the event that starts the work (a pointer move, a message), then return `false` again once the work is done.
- **`time` skips the sleep.** `time` and `deltaTime` count only the frames the loop ran, so a value eased from them does not jump after a sleep.
- **Name every callback** with `label`; the profiler shows it.
- **Animation is anime.js from `@visio/animate`**, already on the loop at `ORDER.animation` (the `animate` skill). Never a second animation library.
- A frame callback writes signals only when the value changed (a string, a rounded number), so a frame that changes nothing updates nothing.
- Never import `tempus` directly; lint bans it in the site and the lab.
- **Reduced motion is `reducedMotion()`**, a signal that follows `(prefers-reduced-motion: reduce)`, false on the server. Read it in an effect, an event or a frame callback, not to choose markup: the server cannot know it, so the first render would not match. Never call `matchMedia` for it yourself.
- **Play only while on screen.** `usePlayInView(() => el, () => video)` plays what the factory returns (anything with `play()` and `pause()`: a `<video>`, an animation) while the element is on screen, pauses it when it leaves, never starts it under reduced motion, and reverts or pauses it with the owner. The factory runs on first sight. `{ threshold: 0.5 }` plays it only while half of it shows. `playInView(el, factory)` is the same outside a component and returns the stop; `watchInView(el, (inView) => ...)` is the observer alone. anime.js animations go in `useAnime` with `inView` (the `animate` skill).
