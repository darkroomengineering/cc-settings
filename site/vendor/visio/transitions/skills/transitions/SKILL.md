---
name: transitions
description: How page transitions work with @visio/transitions - the outlet that keeps two pages alive, usePageTransition, orchestrations, refs to what a page animates, reduced motion, and what the shell may import. Read before adding or changing how a page enters or leaves, or anything that animates during a navigation.
---

# @visio/transitions

`<PageTransitions router={Router}>` from `@visio/transitions` is the outlet (in the app root), not the router's `props.children`. It renders the matched chain from the route table, and during a navigation it keeps two live pages: the outgoing one in a wrapper fixed where the viewer saw it, the incoming one in flow. Wrappers carry `data-transition="exiting" | "entering"` and drop pointer events inline. Design and rationale: `transitions/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```tsx
// a page, once: it holds refs to what it animates
let title!: HTMLHeadingElement; // one element
const headings: HTMLElement[] = []; // many, in render order

usePageTransition({
  exit: ({ page }) => animate([title, page], { y: -30, opacity: 0, duration: 400 }),
  enter: ({ page }) =>
    createTimeline()
      .add(page, { opacity: [0, 1], duration: 300 })
      .add(headings, { y: [40, 0], opacity: [0, 1], duration: 500 }, 100),
});

<Hero titleRef={(el) => (title = el)} />
<SectionIntro headingRef={(el) => headings.push(el)} … />

// a component inside the page exposes a ref prop; it runs no page transition
<h2 ref={(el) => props.headingRef?.(el)}>…</h2>;
```

- A page calls `usePageTransition` once. `exit` runs when the page leaves, `enter` when it arrives; a component in the shell (the nav) calls it too and takes part in every navigation. Handlers return an anime.js animation or timeline, a promise, or nothing. The outlet waits for it and cancels an animation or timeline on interruption; it cannot cancel a plain promise. There is no adapter to pass: anime.js is the one animation library. `page` is the wrapper, `signal` aborts on interruption, `from` and `to` are the path and search of the two pages, `trigger` is `'link'`, `'browser'` (back or forward), or `'appear'`.
- `orchestrate` on `<PageTransitions>` orders the steps: `sequential`, `overlap`, `enterLed` from `@visio/transitions`; it is read at each navigation, so a signal may drive it. The outlet stacks the two wrappers explicitly: the old page paints on top unless the orchestration's `above` says `entering`, which `enterLed` does. The nav needs a `z-index` above 2 to stay over them. `settled()` resolves once the new page has rendered and every promise its route `preload` returned has landed, so a `preload` that returns its `query()` makes the transition wait for the data. A `<Loading>` inside the page shows its fallback in the meantime.
- `skip(nav, forced)` swaps without an animation (the site skips back and forward), and reduced motion always does; `forced` is true when the swap has no handlers anyway (reduced motion, or a layout above still entering). The old page stays until the new one has settled, as in a transition. A navigation during a transition aborts the running handlers, disposes the oldest page, and continues with two. A transition that never resolves is force-completed after five seconds.
- Elements inside the page reach a handler through refs the page owns, never a DOM lookup: a `let x!: HTMLElement` for one element, an `HTMLElement[]` a ref callback pushes into for a list. A shared component exposes the element through an optional ref prop (`headingRef`, `titleRef`); a page that does not animate it leaves the prop off. Handlers run after the page has settled, so the refs are set by then. A list that changes under a `<For>` is filtered on `isConnected` when read.
- Dev checks, dropped from the production build, each say what to do. `usePageTransition` twice under one page prints in the dev server's terminal when the page renders. The others print in the browser console during a navigation: the timeout with the navigation that hung, and an animation with an empty target list, which is a ref prop that was never passed. A component may animate its own intro or interactions; it never runs a page transition.
- A layout shared by both URLs stays mounted: only the levels below it transition, inside its `children` slot, and the layout's `props.location` moves to the new URL (a page's stays pinned). A layout may call `usePageTransition` too; its handlers run when the section enters or leaves, together with the page in its slot, and each handler gets its own wrapper as `page`. The outlet's pages sit in a `<main>`, a slot's in a `<div>`.
- Return the animation as it is and never chain `.then()` on it: an anime.js animation keeps one `then` callback, and the outlet's replaces an earlier one, so a `.then()` in the handler never fires. Use `onComplete` in the animation's parameters.
- A navigation that changes only the query (`?tab=two`) does not transition: the page stays mounted and `props.location` moves to the new query, so read it reactively (`props.location.query.tab` inside JSX or a memo).
- After a navigation the outlet focuses the new page's wrapper when focus went with the old page (a link inside it). Focus in the nav or a sidebar stays put. Do not move focus yourself in a handler.
- `appear` mounts the first page as entering and runs its `enter` once `ready` is true. Without it, first load is untouched and intros stay in the page's components, in `useAnime` (the `animate` skill). Reduced motion is `reducedMotion()` from `@visio/frame`.
- Animate `transform`, `opacity`, `clip-path`, and registered variables only, with easings from the tokens parsed once in `src/lib/motion.ts`, where shared presets live too. Nothing the shell loads (the app root, the nav, the footer, `ui/`, `@visio/transitions`) may import anime.js (`@visio/animate`, the one path to it) or `src/lib/motion.ts`; the nav dims with a data attribute and a CSS transition. An anime.js animation whose tweens a newer animation replaces is cancelled by anime.js and the outlet counts it as finished; avoid animating one element from both exit and enter of the same page.
