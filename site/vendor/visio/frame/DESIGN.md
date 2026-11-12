# @visio/frame: design

One frame loop for a visio site. Every darkroom site ran Lenis and GSAP's ticker on the tempus loop. This package is that loop for Solid 2: `useFrame` puts a callback on it, and the slots in `ORDER` fix what runs first. Smooth scrolling (`@visio/scroll`), anime.js (`@visio/animate`) and a project's own WebGL are clients of the loop, not its owners, so a site can remove any one of them and keep the loop.

## Requirements

1. One `requestAnimationFrame` loop for everything that runs per frame, in a fixed order: the scroll step, then animations, then a canvas. A tween that reads the scroll position then sees this frame's value, not last frame's. A WebGL object that follows an element draws where the element is in this frame.
2. A callback with a lower frame rate keeps its place in that order.
3. Nothing on the server, and nothing that shifts hydration.
4. No other dependency than tempus, so a site that animates nothing pays for the loop only.
5. No frame while nothing needs one. Chrome ticks every running Web Animations API animation on the main thread in each frame the page renders there, with a style recalc and a prepaint per animated element. So a loop that asks for every frame takes the compositor's animations onto the main thread. On a blank page at 4x CPU slowdown, 27 elements with a looping `element.animate()` cost 3.5 ms/s of main thread; one empty `requestAnimationFrame` loop beside them raised it to 379 ms/s, all of it style and prepaint. A linked project's drawing of 27 boxes cost about 195 ms/s for the same reason.

## The design

### API

- `useFrame(callback, { order, fps, label })`: runs `callback` on every frame while the component is mounted, as `Tempus.add` does. `ORDER.scroll` (-10), `ORDER.animation` (0) and `ORDER.render` (10) are the slots; lower values run first. `order` takes one of these three only, and the default is `ORDER.animation`. `fps` is a number only, not tempus's share of frames (`'50%'`). The package passes `order` and `label` to tempus and nothing else, so tempus's `priority` alias is not available. A callback with an `fps` keeps its `order`: the package throttles it itself instead of handing `fps` to tempus (see the facts below). The throttle state is per callback: its first run gets the time since the frame before it was added, and two 30 fps callbacks added on different frames can run on alternate frames. Tempus sees every callback at its default fps, so the label carries the fps for the profiler: `canvas (30 fps)`.
- `frame(callback, options)`: the same outside a component, returning the unsubscribe function. On the server it returns a no-op.
- A callback returns `false` when it needs no next frame of its own. After a frame in which every callback returned `false`, the loop sleeps: it requests no frame until `wake()`. A callback that returns anything else, `undefined` too, keeps it running, so a callback written without the return animates as before. A throttled callback answers on the frames it skips as its last run did, so one that keeps the loop running keeps it at the full frame rate. One that returns `false` counts the time the loop slept toward its `fps`, and when it skips a frame that something else asked for, a timer wakes the loop at the end of its interval: it runs at most at its `fps` and still sees the last scroll of a burst.
- `wake()` runs the loop again from the next frame. A client calls it when it starts to need frames: a gesture, an animation that starts, an object to draw. `frame()` calls it when it adds a callback. A frame that runs, runs every callback, so a callback that only follows the others (a readout of the scroll) returns `false` and still runs on every frame that something else asked for.
- `time` counts the frames the loop ran, not the time it slept, so a callback that takes the time between two frames from `time` (Lenis) does not jump after a sleep. The first frame after a wake is as long as the frame before the sleep.
- The package does not re-export `Tempus` or its options. Its callback types are tempus's under the package's own names, `FrameCallback` and `FrameArgs`, which is tempus's whole state: `time` and `deltaTime` in ms, the `frame` count, and `budget()`, the ms left in the frame, so no type names the library a site may not import. Lint bans an import of `tempus` in the site and the lab, so every callback goes through `useFrame` or `frame` and keeps its slot.

### Motion helpers

The loop is the package that every site loads, the shell too, so the motion helpers that are not anime.js live here.

- `reducedMotion()` is a module-scope signal on one `MediaQueryList` of `REDUCED_MOTION_QUERY`, which only `@visio/frame/internal/motion` exports, so a project reads the signal and never writes the query. `@visio/transitions` reads it to swap pages instantly, and `useAnime` passes the query to anime.js's scope. Before 2026-10-10, `@visio/transitions` exported `prefersReducedMotion()`, the WebGL package called `matchMedia` itself, and a linked project wrote the query in three components.
- `watchInView(element, callback, options)` is one `IntersectionObserver` that reports each change once and returns the stop. The browser sets `isIntersecting` on any overlap, whatever the `threshold`, so the element counts as in view when its `intersectionRatio` also reaches the smallest threshold. `playInView` and `useAnime`'s `inView` build on it.
- `usePlayInView(target, create, options)` and `playInView(element, create, options)` play anything with `play()` and `pause()` while the element is on screen. The factory runs when the element is first seen and the motion is not reduced, so nothing is made for a visitor who never scrolls there or asks for less motion. A change of the query pauses or plays at once. The stop reverts what has `revert()` (anime.js) and pauses the rest (a `<video>`). A `<video>` rejects `play()` when a pause comes first, so the rejection is caught.
- The options are `IntersectionObserver`'s own (`rootMargin`, `threshold`). The lab case `/frame/video` plays a `<video>` with `threshold: 0.5`.
- `test/motion.test.ts` drives them with a fake observer and the fake window's media list. It imports `motion.ts` after `show()`, because the module reads the query at import and an earlier suite may have hidden the window. `usePlayInView` is `playInView` in `onSettled`; Solid's server build, which `bun test` loads, does not run `onSettled`, so the suite tests `playInView`.

### Who is on the loop

- `@visio/scroll`: Lenis, at `ORDER.scroll`. It keeps the loop running while it glides, and wakes it on a gesture, a `scrollTo` and each native scroll (`packages/scroll/DESIGN.md`).
- `@visio/animate`: anime.js, at `ORDER.animation`, from its first import. It keeps the loop running while an animation or a timer runs, and wakes it when one starts (`packages/animate/DESIGN.md`). A `waapi.animate()` animation is not on the loop.
- Anything a site adds with `useFrame`, in the slot that matches what it does. It keeps the loop running while it is mounted, unless it returns `false`.

### Rules for components

- Call `onSettled` on the server as well, even when it only does client work. A Solid 2 component has no owner of its own, so an `onSettled` inside it takes a hydration id from the parent. One registered on the client only shifts every id after it, and whatever comes next in the tree fails to hydrate. `useFrame` follows this.

### What checks it

- `test/frame.test.ts` checks that the loop sleeps after a frame where every callback returned `false`, that `wake()` and `frame()` run it again, and the length of the first frame after a wake. The anime and scroll suites check that their clients sleep and wake.
- Lint bans `requestAnimationFrame` in the site and the lab (`OWN_LOOP` in `packages/oxlint-plugin/src/config.ts`). A package may schedule one frame with it (a resize, a frame of delay), never a loop.

## Facts checked against the installed versions

tempus 1.0.0, without dependencies.

- A hot update of `frame.ts` runs it again while the callbacks the old module wrapped stay on tempus. The loop's state lives in `import.meta.hot.data`, so the old and the new callbacks share it, and the old module's two callbacks of its own are removed in `dispose`.
- Tempus requests a frame from import and in every frame after it, with or without callbacks. `pause()` cancels the frame it requested and stops its clock; `play()` requests one again. Its frame requests the next one after the last callback, so a pause from a callback would be undone; the package pauses in the microtask after the frame. After `play()`, the first frame's `deltaTime` is 0 and `time` does not move, and Lenis would not move in that frame; the package's first callback (order `-Infinity`) gives it the length of the last frame and adds it to `time` from then on.
- Tempus guards `window` at import, so the server bundle can import it. It keeps the `requestAnimationFrame` it found at import; the tests share one fake window for that reason (`test/dom.ts`). `add` returns the unsubscribe function, and `undefined` on the server. It keeps one list of callbacks per `fps` and runs the lists in the order of their keys, so `30` runs before the default `Infinity` whatever the `order`. Its throttle also compares the summed frame times with `1000 / fps` exactly, and two 60 Hz frames add up to a hair under `1000 / 30`, so its 30 fps runs on an uneven cadence. The package's throttle allows 1 ms of slack.
