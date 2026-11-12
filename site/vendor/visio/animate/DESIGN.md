# @visio/animate: design

anime.js for a visio site, and text split into the lines the browser painted. anime.js is the one animation library of the starter. This package is anime.js on the frame loop of `@visio/frame`, at `ORDER.animation`: after the scroll moves the page and before the canvas draws (`packages/frame/DESIGN.md`).

## Requirements

1. One animation library and one way to import it, so that it cannot run on a loop of its own.
2. anime.js steps in the animation slot of the frame loop, so a tween that reads the scroll sees this frame's value, and a WebGL object at `ORDER.render` that follows an animated element draws where the element is in this frame.
3. No call to wire it. A call that a site can forget is a loop that nothing sees.
4. The shell loads no anime.js: only pages and their components import it.

## The design

### API

- `@visio/animate` is the anime.js API: `animate`, `createTimeline`, `stagger`, `utils`, `cubicBezier` and the rest, re-exported from `animejs`. Its first import sets `engine.useDefaultMainLoop = false` and adds `engine.update()` at `ORDER.animation`, labelled `anime.js` (`drive` in `src/drive.ts`). The callback keeps the loop running while the engine has an animation or a timer (its `_head`, the check anime.js's own loop makes), and lets it sleep otherwise. anime.js calls `engine.wake()` when one starts; `drive` wraps that method on the engine, so the call wakes the loop too. So anime.js is on the loop wherever a site uses it. Before 2026-10-05, each app called `driveAnime(engine)` in its `lib/motion.ts`. Without that call, anime.js ran its own loop, and nothing saw it. Until the package split, the same code was `@visio/frame/anime`.
- `easing(token)` turns an easing token, `cubic-bezier(x1, y1, x2, y2)`, into anime.js's `cubicBezier`, so a tween follows the curve a CSS transition reads from the same token. Any other value throws with the form to write. Until 2026-10-07 each app parsed the token with its own regular expression in `lib/motion.ts`.
- The `engine` that the package exports has no `useDefaultMainLoop`, `update` or `wake` in its type, so a site cannot give anime.js its own loop back. Its `defaults` and `timeUnit` stay. `package.json` lists `src/index.ts` in `sideEffects`; otherwise a bundler could take the re-exports straight from `animejs` and drop the call. On the server `frame()` adds nothing, so only the flag changes there.
- A second `drive` of the same engine does nothing, so a hot update of `index.ts` does not step anime.js twice a frame. A hot update of `drive.ts` itself stops what the old module added before the new one runs. The stop is internal, for the tests and for a hot update.
- The re-export costs nothing in the bundle: a site that imports `animate` alone gets the same anime.js modules as from `animejs`, 33 bytes more for the call.

### `animate()` and `waapi.animate()`

`waapi` is in the re-export, and its animations do not step on the loop: anime.js builds them with the Web Animations API, so it runs no JS per frame for them. So requirement 2 holds for `animate()` and not for `waapi.animate()`, and the skill says which one to use. `animate()` is for motion that reads something per frame (the scroll, a JS value, another animation) and for an element that a WebGL object follows, because the renderer reads the element's box in the same frame. `waapi.animate()` is for a loop or a tween whose values are fixed when it starts. It needs no main-thread work per frame from anime.js, and it does not keep the frame loop running, so on a page where nothing else moves the main thread renders no frames (`packages/frame/DESIGN.md`, requirement 5). Its parameters are a subset of `animate()`'s: of the callbacks only `onComplete`, DOM targets only, and an easing function sampled into a CSS `linear()`. Both return `play`, `pause`, `cancel` and `revert`.

Whether the browser then runs a WAAPI animation on the compositor depends on the property. anime.js passes `rotate`, `scale` and `opacity` through as CSS properties, but writes `x`, `y` and the per-axis transforms (`translateX`, `rotateZ`) as registered custom properties (`--translateX`), which Chrome does not animate on the compositor. This is read from the source of anime.js 4.5.0 and not yet measured in a browser with a GPU, so the skill does not give a rule for it yet.

A linked project measured one swaying drawing on 2026-10-10 (Chrome, 4x CPU throttle, main-thread time over the same page with the animation paused):

| What moved | Main thread | Per frame |
| --- | --- | --- |
| `<g>` groups in one inline `<svg>`, `animate()` or WAAPI | +358 ms/s | layout and paint, off screen too |
| One `<Image>` per part in its own `<div>`, `animate()` | +195 ms/s | layerize |
| WAAPI on each part's `<svg>` element, with no wrapper | +131 ms/s | layerize |
| `waapi.animate()` on the wrapper `<div>`s | +27–64 ms/s | no layout, no layerize |

The range in the last row is over the project's runs; it did not report what made it vary. So a part that moves is a box of its own, and a drawing is split into parts at its source (the `images` skill). An endless animation also costs while it is off screen, so `useAnime` can pause it there.

### `useAnime`

Every animated component repeated the same `onSettled` code: refs into arrays, a reduced-motion check, an `IntersectionObserver` that plays and pauses, and a revert on cleanup. A linked project had it in each component. `useAnime(root, constructor, options)` is that code once, on anime.js's own `createScope`, as `useGSAP` is for GSAP in React:

- It runs in `onSettled`, so the refs are set and the server runs nothing (no ref is set there, so the root is undefined). It reverts the scope in the cleanup, which reverts every animation that the constructor made, `animate()` and `waapi.animate()` alike: both register with the scope that is running.
- The root is the scope's `root`, so anime.js resolves a selector inside it. A part is a data attribute; no ref array is needed.
- `mediaQueries` always has `reduceMotion: REDUCED_MOTION_QUERY` from `@visio/frame/internal/motion`, merged with the site's own queries. anime.js reverts the scope and runs the constructor again when a query changes, so the constructor reads `scope.matches.reduceMotion` and the motion follows the setting without a reload.
- `inView` uses `watchInView` from `@visio/frame`. When the root leaves the screen, and after each run of the constructor while it is off screen, it pauses each animation of `scope.revertibles` that is running and has no `parent`, and keeps a list of them. When the root comes back, it plays that list and nothing else. So an animation with `autoplay: false` that waits for a click, or one that `onScroll` links to the scroll, is left alone, and a timeline's children stay on the timeline's clock: anime.js registers each child with the scope too, and a child played alone would run on its own. Until the first report, which comes on the next frame, the root counts as off screen. An animation that a scope method makes later is paused at the next exit only.
- There is no option to defer the constructor until the root first comes on screen. `lazy` did that from 2026-10-12 (#264) until it was removed the same day. A project measured it on a home page with nine drawings whose constructors parse the raw SVG, read part bounds and clone the drawing per layer (production build, 4x CPU slowdown, scroll through Lenis). Without `lazy`, the constructors run in one task of about 1000 ms at the end of hydration, and the scroll after it is smooth. With `lazy` and a `rootMargin`, the longest task at load drops to about 250 ms, but each constructor runs while the visitor scrolls, as one block of 90-350 ms per drawing (25-90 ms without slowdown). Lenis moves the page on the main thread, so each block is a visible stutter. Deferring a constructor to its first view does not remove its cost: it moves it from the load, where nobody scrolls yet, to the moment when the main thread matters most. A light constructor gains nothing, and a heavy one gets worse. A heavy constructor must get cheaper, with the work done at build time, or run in idle time before the visitor gets to it, not later. `useAnime` has no option for idle time yet; build it when a project needs it.
- The options are `createScope`'s own, without `root`, plus `inView` (the rule for library options in `AGENTS.md`). The hook returns nothing; a site that needs the scope outside the constructor reads it there.
- A change of a media query runs the constructor again. An intro that must play once keeps a flag in the component and returns on the second run, as the site's `Hero` does; otherwise a visitor who turns reduced motion on and off sees it again.
- No unit test: under `bun test` solid-js is its server build, where `onSettled` never runs. The lab case `/frame/drawing` is the proof: the count of running animations is 0 off screen, 5 in view, 0 under reduced motion, and the same after a navigation away and back; an animation with `autoplay: false` starts only on its button, not when the drawing comes into view.

### Text

`splitText(target, options, effect)` splits text with kugiri, in place of anime.js's splitter. Until 2026-10-26 the package was `@visio/anime`, and a site split with anime.js's `splitText`. With `lines`, that one splits only after `document.fonts.ready` resolves, also when the fonts are loaded, so `split.lines` was `[]` after the call, and the skill taught an `addEffect` in `scope.execute()` (#346) that an agent had to remember. kugiri reads the lines off the painted text (`Range.getClientRects()`), so `text-wrap: balance`, `<br>`, right-to-left text and hyphenation come out as painted, and it splits in the call. It does nothing after the split, by design: waiting for fonts, splitting again on a resize and reverting are the caller's. This package is that caller:

- `splitText` runs only in the constructor of `useAnime`, which hands it the root, the scope and a list of cleanups (`runInSplitContext`); anywhere else it throws `SPLIT_OUTSIDE_SCOPE`. A selector resolves inside the root, and every match is split in one kugiri pass, which plans all targets before it writes.
- `effect` runs in `scope.execute()`, so the animation it makes is in the scope: `inView` pauses it and `defaults` apply. After each split, `useAnime` pauses what the split started when the root is off screen.
- A `ResizeObserver` on each target splits it again when its width changes, at most once a frame, on the frame loop at `ORDER.animation`. A change of height moves no wrap and is ignored, and so is a width of 0: a hidden target has no lines. A `loadingdone` event of `document.fonts` splits every target again, since a font that loads changes the lines.
- `effect` is wrapped in anime.js's `keepTime`: once the next split is written, it reverts the animation the effect returned, on the old lines that are out of the page by then, and the new one starts at the time the old one had, so a finished reveal stays finished. A returned cleanup function runs before the next split. anime.js's `addEffect` works the same way.
- anime.js registers every animation with the scope it is made in, and `revert()` does not take it out, so before each split the package takes the old split's animations out of `scope.revertibles` and out of what `inView` holds paused. Without it, the list grew by one animation per target on every split, and `inView` played a reverted animation again when the root came on screen.
- The cleanup of the constructor, when the scope reverts on unmount or a media query change, stops the observers, reverts the animations and then the split.

A split replaces the nodes of its target. The first split keeps each element of the target in the page, with the part of its content that fits its first line (a clone carries the rest), but its `revert()` writes the saved `innerHTML` back, and every split after the first starts with a revert. So after a resize or a font load, no node that Solid holds inside the target is in the page: a signal that writes text there writes to a detached node, and a delegated handler (`onClick`) sits on a node nobody clicks. In the lab case `/frame/split` (2026-10-26), a button in a split heading counted its clicks until the next split, then counted none. A link still navigates: the router handles a click on any `<a href>`. So a site splits text that does not change while it is mounted. In dev, `SPLIT_HAS_HANDLERS` warns when an element in the target has a delegated handler, which @solidjs/web keeps on the node as `_$$click` (read from its source); a reactive text node leaves no mark to check. Keeping Solid's nodes alive would mean a hidden copy for Solid and a split clone on screen, split again whenever the copy changes: twice the DOM, and the measured box may not be the one on screen. Build it when a site needs live text split.

The entry has every module of anime.js but `text` (`src/anime.ts`), so anime.js's `split`, `splitText`, `TextSplitter` and `text` are not values of the package; `scrambleText` is. `test/exports.test.ts` fails when anime.js adds a value the entry does not have. kugiri adds about 8 kB gzip, with the wrapper, to a page that imports `splitText` (measured with `bun build --minify`, 2026-10-26), and nothing to one that does not.

### Why a package of its own

`@visio/frame` is the loop, and it depends on tempus only. A site that animates nothing still has the loop, for the scroll and anything that draws. Like `@visio/scroll` for Lenis, this package is the one way in to its library, and the lint message names it.

### What checks it

- Lint bans an import of `animejs` and of `kugiri` in the site and the lab, so every use goes through `@visio/animate` and is on the loop. It also bans the other animation libraries (GSAP, Motion, Popmotion, React Spring, Theatre.js, Velocity, mo.js), because each one has a loop of its own. CSS transitions and animations stay allowed: the styling compiler checks them, and they are the tool for a state change.
- Lint bans `@visio/animate` in the shell (the app root, the nav, the footer, `ui/`), with the reason in `packages/transitions/DESIGN.md`.

## Facts checked against the installed versions

anime.js 4.5.0, kugiri 0.5.3.

- anime.js adds an animation or a timer to the engine in one place, `Timer.resume()`, and calls `engine.wake()` right after it. The engine drops a paused or finished one in its next `update()`, so the loop sleeps one frame after the last one ends. A timer made while the loop sleeps still starts on time: its constructor brings the engine's clock up to date itself when anime.js's own loop is off.
- anime.js starts its own loop only in `engine.wake()`, which it calls when an animation starts. Setting `useDefaultMainLoop` back to `true` while an animation plays does not restart it, so the internal stop calls `wake()`.
- anime.js takes any `window` for a browser and reads `document` at import. The test window (`packages/frame/test/dom.ts`) has no document, so the tests drive a fake engine through `drive`, and check the real engine and the narrowed export by type only.
