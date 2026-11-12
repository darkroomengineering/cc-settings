# @visio/transitions: design

Status: decided 2026-09-11, built the same day in the site, moved into this package on 2026-09-22 so that the lab (`lab/`) and any site can use it. The brief stands; the section at the end lists where the build differs and why.

## Requirements

- Programmatic animations with anime.js 4. No View Transitions API, no CSS-only engine.
- Both pages on screen at once during a transition, and both live: the outgoing page keeps its reactive graph until it is disposed, the incoming page runs from the moment it mounts. No cloned or frozen DOM, no remount of either page.
- One transition per page, declared in the page. A component never runs a page transition itself; it hands the page the elements the transition animates through a ref prop. A component may still animate its own intro or its interactions on its own (`hero.tsx` runs its intro with `useAnime`).
- First-load choreography with a preloader gate.
- The author controls the sequence: sequential, overlapped, or enter-led.
- Small runtime: one set of handlers, no registries per component, no DOM lookup.

## Why the outlet moves

Solid Router renders exactly one page. Two live pages means the transition component renders pages itself, from the router's match, under owners it controls. The router keeps history, link interception, preload on hover, `query`/`action`, single flight, and meta. Only the outlet moves.

Rejected on the way here, with the reason:

- The novus `@novus/transitions` package (React Router). Its page stack is the right idea, but half of its 1,300 lines exist because of React's render model, and its outgoing page is a frozen React element. Do not port it.
- Delaying the commit with `useBeforeLeave` and animating only a shell curtain: no overlap of the two pages.
- The View Transitions API: the old page is a pixel snapshot and anime.js cannot reach the pseudo-elements.
- A second router with `memoryHistory` for the outgoing page: it remounts the page and resets its state.

## The design

`PageTransitions` is the outlet, rendered as the child of the `Router` render prop instead of `props.children`.

- It reads `useLocation()`. For a URL it calls `Router.match(url)` (`OutputMatch[]`, from the router `defineRoutes()` makes in `src/routes.ts`) and renders the match chain, layout then page, under its own root, passing `RouteSectionProps` (`params`, `location`, `data`, `children`) pinned to that URL. Route definitions come from our own table (`@visio/router`: `page()` yields `{ path, component, preload, matchFilters }`; `component` is the module's own `lazy()`; the router renders the page's head, not the outlet, `packages/router/DESIGN.md`, Meta), so no router internals are touched.
- On navigation it mounts the next page the same way and keeps both, at most two. The orchestration decides when the old root is disposed.
- On the server and on first render it emits exactly one page and nothing else, so prerender output and hydration do not change. Verify this first.
- Each page sits in its own wrapper. During a transition the outgoing wrapper is `position: fixed` at the box it had at the moment of navigation, so the old page does not jump when scroll resets. Wrappers carry `data-transition="exiting" | "entering"` for a site's own styles, and an inline `pointer-events: none` while in either state. The leaving wrapper is also `inert`, so Tab and a screen reader skip it. It also gets the `data-theme` that `<html>` had before the navigation, read in `useBeforeLeave`, because the next page's route theme (`@visio/styling`) may change `<html>` before the outlet's effect runs; so the leaving page keeps its colours while the entering one shows its own.

### API

```tsx
// src/app.tsx
<Router>
  {() => (
    <>
      <Nav />
      <PageTransitions
        router={Router}
        appear
        ready={ready()}
        skip={(nav) => nav.trigger === 'browser'}
        orchestrate={overlap}
      />
      <Footer />
    </>
  )}
</Router>;

// the orchestrations the package exports
export const sequential: Orchestration = async ({ exit, enter, settled, remove }) => {
  await exit();
  await settled();
  remove(); // the old page is out, so nothing uncovers it again
  await enter();
};
export const overlap: Orchestration = async ({ exit, enter, settled }) => {
  const leaving = exit();
  await settled();
  await Promise.all([leaving, enter()]);
};
export const enterLed: Orchestration = async ({ exit, enter, settled }) => {
  await settled();
  await enter(); // enter may itself await assets
  await exit();
};

// a page: it holds refs to what it animates
let title!: HTMLHeadingElement;
const headings: HTMLElement[] = [];

usePageTransition({
  exit: ({ page, signal }) =>
    animate([title, page], {
      y: -30,
      opacity: 0,
      duration: 400,
      ease: EASE_IN_OUT,
    }),
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

- `usePageTransition(handlers)` registers for the component's lifetime. A page calls it once. The nav, a canvas, or a curtain in the shell call it once and take part in every navigation. Registration is one `Set` of handler objects in a context; cleanup removes the entry.
- `exit()` runs every handler of the old page and of persistent chrome; `enter()` every handler of the new page and persistent chrome. `settled()` resolves when the new page's own `<Loading>` boundaries have resolved (`onSettled` in the new page's root). `remove()` takes the old page off screen before the orchestration settles; `sequential` calls it before `enter()`, so a curtain in the chrome lifts off the new page even when the old one has no exit of its own. The outlet adds no `<Loading>` of its own, so the streamed shell behaviour in `AGENTS.md` stays.
- Handler context: `page` (the wrapper element), `from`, `to`, `trigger` (`'link' | 'browser'` from the router's `intent`, or `'appear'` for the first enter), `signal` (an `AbortSignal` for interruption). Handlers return an anime.js animation or timeline, a promise, or nothing. The outlet waits for it, and cancels an animation or timeline on interruption.
- `appear`: the first page mounts with `data-transition="entering"` and `enter` runs once `ready` is true. A navigation before `ready` replaces the appear: the new page enters through the navigation, and `appear` then does nothing. Without `appear`, first load is untouched and intros stay in the component, with `useAnime` (see `hero.tsx`).
- `skip(nav, forced)`: return true to swap without handlers. The old page stays until the new one has settled, then the pages swap; until 2026-10-12 they swapped at once, and a page whose data had not landed showed empty (`packages/router/DESIGN.md`, Dependent reads). The outlet calls it for every navigation. `forced` is true when the pages swap without handlers anyway: reduced motion (`reducedMotion()` from `@visio/frame`), or a layout above that is still entering (see "Shared layouts persist" below). A log of navigations reads it.
- Interruption: a navigation during a transition aborts the running handlers through `signal`, disposes the oldest page, and starts again with two. One safety timeout, five seconds, force-completes a transition or an appear whose promise never resolves. It counts from the moment the new page settles, so a slow preload does not use up the handlers' time; a page that never settles is force-completed five seconds after the navigation.
- A handler that throws or rejects is reported through `reportError`. The other handlers still run, and the transition ends as usual: under `sequential` the enter runs after a failed exit. A rejection after an interruption is not reported, because an animation that is cancelled on `signal` rejects.
- Elements inside the page reach the handler through refs the page owns: a `let` for one element, an array a ref callback pushes into for a list, in render order. A shared component exposes the element through a ref prop (`headingRef` on `SectionIntro`, `titleRef` on `Hero`). Nothing is looked up in the DOM, and the type checker sees every use.

### Rules for pages

- Pages read `props.params`, `props.location`, `props.data`. Never `useParams()` or `useLocation()` inside a page: they see the new URL while the old page is still animating. The starter already follows this; it is a rule in the Solid skill and a lint error (`visio/restricted-imports` over `src/pages/`, `src/components/` and `src/ui/`, from the lint preset in `@visio/oxlint-plugin/config`).
- Animations touch transform, opacity, clip-path, and registered variables only, as the styling compiler requires. Read easings from the tokens through `EASE_OUT` and `EASE_IN_OUT` in the site's `src/lib/motion.ts`, parsed once. The shell never imports anime.js (`@visio/animate`, the one path to it, on the frame loop), and neither does this package: the nav dims with a data attribute and a CSS transition, so the engine loads with the first page that animates.
- Two pages alive means two head registrations for a moment; the new page's meta registers later and wins, and the old page's retracts on dispose. Check the title does not flicker.

## Build order

1. The outlet with one page and no animation. Match, render the chain with pinned props, layouts included. Prove prerender output and hydration are byte-identical to today on the demo site.
2. The two-page stack: mount the next page, position the outgoing wrapper, dispose on completion, interruption handling.
3. `usePageTransition`, the orchestration functions, `skip`, reduced motion, the timeout.
4. `appear` and `ready`.
5. Wire the demo: one overlap between home and patterns, the nav dimming as persistent chrome. Update `.claude/skills/solid-2/SKILL.md` and `AGENTS.md`.
6. The lab (`lab/`, 2026-09-22): a second app on the same packages with one page per case, a mode switch between `sequential`, `overlap`, `enterLed` and a curtain, and a trace of every step with its timing, so a change here is tried against every sequence before a site picks one.

`appear` is the lab's case g. Smooth scrolling is `@visio/scroll` (2026-09-25): Lenis runs on the shared frame loop and stops its glide when a navigation starts, so the router's reset still lands in one step and the leaving wrapper's measured box stays true.

## Facts checked against the installed versions

- `@solidjs/router` 2.0.0-next.38 exports `useLocation`, `useIsRouting`, `useBeforeLeave`, `usePreloadRoute`, `memoryHistory`, and the instance has `routes` and `match(url): OutputMatch[]`. The intent of a navigation is internal to the router's context; the outlet reads back and forward from `useBeforeLeave`.
- `RouteSectionProps<T, P>` is `{ params, location, data, children? }`.
- Solid 2 rc.14: `onSettled` for lifecycle and settle detection, `createEffect(compute, apply)`, `dynamic()` for the wrapper's tag, no `onMount`, no `createResource`.
- anime.js 4 animations and timelines are awaitable.

## What the build changed, and why

- The outgoing wrapper is `position: fixed` at the box it had at the moment of navigation, not absolute plus a scroll offset. When this was built the site scrolled smoothly with `html { scroll-behavior: smooth }`, so the router's reset moved the document over several frames and an absolute box slid with it. Lenis from `@visio/scroll` replaced that rule, and forbids it (`packages/scroll/DESIGN.md`, CSS). A fixed box stays where the viewer saw it whatever the scroll does, so the choice holds.
- `trigger` comes from `useBeforeLeave`, where the router confirms a history traversal with a number and a link with a path. The router's `intent` is only readable while its transition is pending, and the outlet's effect runs after the commit. `'appear'` is a third value, for the first enter.
- `settled()` resolves once the new page's own render has settled and every promise its route `preload` returned has landed: a promise, or the promise-valued properties of an object, the same `settle()` the head uses. `onSettled` in the page's root fires while a `<Loading>` inside still shows its fallback, because a boundary contains its pending reads, and Solid 2 rc.14 has no public hook on descendant boundaries (the reveal controller is internal). A page that must wait for data returns its `query()` from `preload`, which the skill already asks it to call, and chains a read that needs that data there too.
- The outlet restores the scroll offset on back and forward (2026-09-27). Solid Router saves an offset per history entry and scrolls to it once the traversal settles (`onSettled`), but that is before the outlet mounts the returning page: when the page being left is short, the document is too, and the browser clamps the offset to 0 (#88). The outlet records offsets the same way, from scroll events keyed by the router's `_depth`, except while a navigation is in flight, when pinning the leaving page clamps the scroll and history already points at the target. It scrolls once the returning page has settled and a frame has passed, unless a wheel, touch or key press came first. A push drops the offsets of the entries forward of the one it left: a link reuses the depth of those dead entries, and without that its page took their offset on a later back and forward. The router writes the new entry after the outlet's effect, so the drop waits until history shows a greater depth, at the latest a frame after the page settles. A replace keeps the depth and drops nothing. Chrome caps `history.length` at 50, which the router's `_depth` is derived from, so in a tab with a longer history every new entry gets the same depth; both restores then read the wrong offset. That is the router's to fix.
- The outlet marks what `preload` returns as handled (2026-09-27). The router calls a route's preload with a private flag set, under which `query()` swallows the rejection of the promise it returns; the outlet calls preload itself and cannot set the flag, which `@solidjs/router` does not export. A query that failed before anything read it was an unhandled rejection, and Node exited the dev server (`/account` without `SESSION_SECRET`). So pages return every query their preload starts, and the outlet attaches a no-op `catch` to the return; the page still sees the rejection through `props.data`. Since 2026-10-12 the route table marks the return handled at the call too (`packages/router/DESIGN.md`, Meta), which covers a promise that rejects before the outlet runs.
- The outlet calls `preload` untracked (2026-10-05). A preload calls the page's queries, and a query read under tracking subscribes to the router's revalidation. The render of a page did that read, so every action, which revalidates the queries, mounted the page a second time: it lost its state, its preload ran again, and the new copy called `usePageTransition` before the old one was gone, which the dev check reported as a second call (#173, the lab's session case a). The page still updates, because its own reads in the component stay tracked.
- An anime.js animation whose tweens a newer animation replaces is cancelled by anime.js and never completes. The outlet treats its pause as its end, otherwise the nav's exit under `overlap` would only finish on the safety timeout.
- anime.js is the one animation library, and the outlet always uses it (2026-10-05). `run()` gives every handler result to `awaitMotion` in `src/anime.ts`. It returns a promise that settles when the motion is over, and it cancels an animation or timeline when the signal aborts. It finds an anime.js animation by its `cancel`, so it imports nothing, and the shell still loads no anime.js. Before, a site passed an `Adapter` on `<PageTransitions adapter={anime}>` (2026-09-22), and the prop was required from 2026-10-01, because an anime.js animation is thenable: without the adapter, the outlet waited for it but never cancelled it. The starter has one animation library, so the prop, the `@visio/transitions/anime` export and the `awaited` default went. Nothing is left to pick or to forget.
- `pick(name)` and `data-motion` marks were replaced by refs (2026-09-22). The mark was a string on both ends that nothing checked, and the lookup was the one DOM call in the runtime. A page now holds a ref to each element it animates, and a shared component exposes a ref prop; a misspelled variable is a type error. What refs cannot see, a ref prop that was never passed, the dev checks below report.
- Dev checks, under `import.meta.env.DEV` so the production build drops them, each naming the fix. Each lives at the earliest point where its information exists, since an agent reads the terminal and not the browser console. `usePageTransition` called twice under one page is counted in the component body (`declare` in `src/runtime.ts`), so the server render prints it in the dev server's terminal; the count is released in the call's cleanup, so a component that a hot reload remounts is not counted twice. The rest need a navigation in the browser: the timeout fired, naming the navigation; a handler threw; and in `src/anime.ts`, an animation or timeline child with an empty target list, which is what an unbound ref produces. A lint rule covers a ref that is declared and bound in the same file; the check in `src/anime.ts` stays for a ref prop that a component in another file never passes. `sideEffects: false` lets the bundler drop the helpers with their callers.
- The page stack, the running transition, its interruption and timeout, and the handler calls live in `src/runtime.ts`, with no Solid and no DOM calls except the measure of the leaving wrapper. `PageTransitions` makes the entries, renders the stack the runtime hands back through `onPages`, and calls `navigate` from its location effect. `test/runtime.test.ts` drives the runtime with fake pages: sequential order, skip, layers, the measured rect, interruption, a superseded orchestration resolving late, the timeout and when it starts, a rejected orchestration, a handler that throws, an interrupted `overlap`, `appear`, a layout's slot, an anime.js animation cancelled on interruption, and the dev checks. The scroll memory (`src/scroll-memory.ts`) and the announcer (`src/announcer.ts`) have their own tests against a fake window and document.
- Both wrappers are positioned with an explicit `z-index` while on screen together: the leaving one fixed, the entering one relative. Without that, whichever page happens to have an opacity below 1 or a transform forms a stacking context and paints on top, so the order flipped as the animations ran: under `overlap` the entering page faded in above the old one, dropped beneath it the moment its opacity reached 1, and the still-leaving old page popped back over it; under `enterLed` the new page ended up under the opaque old one. Which page is on top is the orchestration's `above` (`enterLed` says `entering`; the others leave it at `exiting`, so the old page reveals the new one as it goes). There is no prop to override it (2026-10-05): the orchestration is the one place that says which page is on top. The leaving wrapper's `transform-origin` is the centre of the viewport, so a scale pivots around what is on screen rather than the middle of a page that may be several screens tall. A sticky nav needs a `z-index` above 2 to stay over the pages.
- The entering wrapper is `visibility: hidden` from mount until its enter runs, or until the swap when nothing animates. Found in the lab with a page whose preload takes a second: under `sequential` the old page had left and the new page's loading fallback sat at full opacity for the whole wait, then snapped to the first frame of its enter. With `appear`, the first page is hidden in the prerendered HTML as well, until `ready`.
- Shared layouts persist (2026-09-25). The first build rendered the whole chain inside each page's wrapper, so a sidebar in a layout faded out and back in with every page under it, and lost its state. Every level of the chain is now a stack of its own: the outlet's, and one in each layout's `children` slot. On navigation the outlet walks down while a level is the same route with the same values for the params its own pattern names, moves those levels to the new location, and navigates the first stack that differs; the last level always differs, since the URL did. A layout's handlers run when the section enters or leaves; the run walks into the page in its slot (`Scope.child`), so that page's handlers run with it, each with its own wrapper as `page`. A navigation inside a layout that is still entering (from `/` to `/docs/a`, then a click on `/docs/b`) swaps the slot's page in place: the layout's enter runs the new page's enter, and a transition of the slot's own would run it a second time. The runtime of a slot knows the runtime of its layout (`parent`) and swaps while any stack above runs. When the layout's enter has already started, the new page swaps in with no handlers of its own. A slot's pages sit in a `<div>`, since only the outlet's are the document's `<main>`. When a leaving layout is removed, the transition still running in its slot is stopped, one microtask after the render that removed it, so abort listeners that write state do not write in an owned scope (found in the lab as `REACTIVE_WRITE_IN_OWNED_SCOPE` from the trace's listener). The lab's case d is a layout with a stateful sidebar.
- A navigation that changes only the query keeps the page (2026-09-25). The first build treated any new URL as a new page, so tabs or filters in the query string remounted the page and lost its state, found with the lab's case e. When every level of the new chain is the same route with the same params, the page stays mounted and its `location` moves to the new query, as a shared layout's does. There is no switch to transition such a navigation (the `transitionSearch` prop went on 2026-10-05). Pinning still holds where it matters: a page never sees a new location while it is leaving.
- Focus follows the navigation (2026-09-25). The lab's trace showed focus on the body after every navigation: the clicked link sat in the page that left, and the browser drops focus when an element goes, so a screen reader started over at the top of the document. When a navigation puts its page at rest (`onLanded` from the runtime, not for an interrupted one or `appear`), the outlet focuses that page's wrapper if focus was lost, with `preventScroll` so scroll reset and restore are untouched. Focus that sits somewhere that stayed, a nav or sidebar link, is left where it is, and a URL with a hash leaves it to the anchor. Wrappers carry `tabindex="-1"` and an inline `outline: none`. The title is announced separately, below.
- The router, not the outlet, tells the prerender crawl every static route, so a page nothing links to is still written (`packages/router/DESIGN.md`, Prerender). Until 2026-10-08 the outlet called `announce()` for it.
- The new page is announced (2026-09-25). A navigation from the chrome left focus on the nav link, so a screen reader heard nothing at all, and a focused wrapper has no name of its own. The outlet adds one visually hidden polite live region (`#visio-announcer`, inline styles) to the body when it mounts, since a screen reader only speaks changes to a region that was already there, and every navigation that lands clears it and writes `document.title` into it a timeout after the new page settles, so the head has the title from the preload's data. The clear makes the same title twice heard twice. Not on first load, where the screen reader reads the document itself, nor for a query-only navigation, which keeps the page. Layouts that stay do not land, so a navigation is announced once.
- The prerendered HTML is identical except the hydration ids, which Solid derives from the position in the owner tree and which the outlet's `For` row shifts. The ids are consistent between server and client, and hydration was verified in a headless browser: no errors, one page, hydrated events, link, back, and direct loads.
- Handlers get no `ctx` (2026-10-05). It was a plain object shared by the exit and the enter of one transition, for measurements. Nothing used it, and a variable in the page holds a measurement as well.
