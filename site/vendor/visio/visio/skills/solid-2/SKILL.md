---
name: solid-2
description: How to write Solid 2 itself. Reactivity rules, control flow, async and boundaries, stores, queries, actions and server functions, env, middleware, server and browser code, tests, and what changed from 1.x. Read before writing or changing any component or server code; the package skills (router, transitions, scroll, session, images, styling, sanity, visio) build on it.
---

# Solid 2

Solid is not React, and Solid 2 is not Solid 1. Components run once, reactivity is fine-grained through signals, and most 1.x APIs were renamed or removed. The full reference ships with the installed version: `node_modules/solid-js/CHEATSHEET.md` is the public API on one page and ends with the list of things that changed from 1.x. This file is the part that matters most.

## Imports

```tsx
import {
  render,
  hydrate,
  Portal,
  isServer,
  useHead,
  httpStatus,
} from "@solidjs/web";
import { query, action } from "@visio/router"; // Solid Router's, re-exported; never '@solidjs/router'
import {
  createSignal,
  createMemo,
  createEffect,
  onSettled,
  For,
  Show,
  Loading,
  Errored,
} from "solid-js";
```

Stores live in `solid-js` too. There is no `solid-js/web` or `solid-js/store`. JSX types come from `@solidjs/web` (`jsxImportSource` in the tsconfig).

## Reactivity rules

- **Props are values, not accessors.** Pass `<Row item={item()} />`, read `props.item` in JSX. Never destructure props; `function Row({ item })` reads once and is dead.
- **Read reactive values inside JSX, a memo, or an effect.** A read at the top of a component body, or at the top of a `<For>` or `<Show>` callback, freezes at its first value and warns in dev.
- **No writes inside an owned scope.** Setting a signal from a component body, memo, or effect compute throws in dev. Writes belong in event handlers, `onSettled`, and actions.
- **Reads update after the microtask flush.** `setX(1); x()` still returns the old value. In tests call `flush()` before asserting.
- **`createEffect(compute, apply)` is the only effect form.** The first function tracks, the second runs the side effect with the value and may return a cleanup.
- **`onSettled(() => { ...; return cleanup })` is component lifecycle.** It replaces `onMount` plus `onCleanup`. It also works inside event handlers to defer until the transition settles.
- **App-wide state is a module-scope signal** in `src/state/`, not context: `export const [count, setCount] = createSignal(0)`. Context is for state scoped to a subtree, and `<Ctx value={...}>` is the provider.
- **`class` takes strings, arrays, and objects.** `class={[s.card, open() && s.open]}` and `class={{ [s.accent]: active() }}` compose; there is no `classList`. The styling compiler checks class arrays for overlapping properties; see the styling skill.
- **Refs are functions.** `ref={(el) => (node = el)}`; directives are `ref={autofocus}`, composed with arrays.
- **Attributes are lowercase and booleans are presence.** `tabindex`, not `tabIndex`; `<video muted={false} />` removes the attribute; enumerated attributes like `draggable` take the string `"false"`. Event handlers stay camelCase.

## Control flow

```tsx
<For each={items()}>{(item, i) => <Row item={item} index={i()} />}</For>      // keyed by identity: item is a value, i an accessor
<For each={items()} keyed={false}>{(item, i) => <Row item={item()} />}</For>   // non-keyed (the old Index): item is an accessor
<Repeat count={n()}>{(i) => <Cell index={i} />}</Repeat>                      // by count, no diffing
<Show when={user()} fallback={<Login />}>{(u) => <Profile user={u()} />}</Show> // the function child gets an accessor
<Switch fallback={<NotFound />}><Match when={a()}>...</Match></Switch>
<Loading fallback={<Spinner />}>...</Loading>   // async boundary (was Suspense)
<Errored fallback={(err, reset) => <button onClick={reset}>retry</button>}>...</Errored>
<Reveal collapsed>...</Reveal>                  // coordinates sibling Loadings (was SuspenseList)
```

`dynamic(() => cond() ? A : B)` from `@solidjs/web` makes a stable component from a choice; `clientOnly(() => import('./Chart'))` renders a component in the browser only, with a `fallback` prop for the server.

## Async

Async is any computation that returns a promise: `const user = createMemo(() => getUser(id()))`. Reading `user()` before it settles suspends the nearest `<Loading>`. There is no `createResource`.

```tsx
export default function Account() {
  const user = createMemo(() => getCurrentUser());
  return (
    <section>
      <h2>Account</h2> {/* static: in the shell, never waits */}
      <Errored fallback={(error) => <p>Could not read the session.</p>}>
        <Loading fallback={<p>Reading the session…</p>}>
          <Show when={user()} fallback={<SignIn />}>
            {(u) => <p>{u().name}</p>}
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}
```

- **Put the `<Loading>` inside the page, around the part that reads data.** Not in the app root around every route: a boundary that suspends holds back everything inside it, including the page's head tags and static copy, until the data lands.
- **Put an `<Errored>` around a `<Loading>` whose read can fail** (a session, a live API). Without it, a read that rejects after a client navigation halts the reactive system and the page freezes on the old route.
- `isPending(() => user())` is true while a change is in flight; use it for an "updating" state, not for the first load.
- `latest(id)` peeks at the in-flight value during a transition.
- Mutations are `action()`; `createOptimistic` and `createOptimisticStore` show the expected value while the action runs; `affects(x)` marks data the server will change; `refresh(x)` re-asks quietly.
- Store setters take a draft: `setStore((s) => { s.list.push(x) })`. `reconcile`, `snapshot`, `createProjection` cover the rest.

## Data and server functions

```ts
// src/lib/docs.ts, the data layer the UI imports
export const getDoc = query(async (slug: string) => {
  "use server";
  return readDoc(slug); // from src/server, never bundled for the client
}, "doc");
```

- `'use server'` as the first statement makes a function run on the server. On the server it is a plain call; in the browser the compiler turns it into a typed fetch against `/_server`.
- Reads go in `query(fn, key)`: cached per key and arguments, shared between preload and render, revalidated after actions. Writes go in `formAction(fn)` from `@visio/router`; a `<form action={myAction} method="post">` works before hydration, and the response carries refreshed route data in the same round trip (`visio()` registers the router of `src/routes.ts` as the single-flight collector).
- Modules that import Node or a database start with `import 'server-only'` and live in `src/server/`. Pulling one into client code fails the build naming the importer.
- Inside a server function, `getRequestEvent()` is the request: `request`, `locals`, and the mutable `response` head. `redirect(url)`, `reload({ revalidate })`, and `respond(value, init)` from `@solidjs/web` are the response helpers. `GET(fn)` declares a read cacheable over HTTP; `live(fn)` streams an async iterable with reconnect.

## Server and browser

Browser-only code (`window`, `localStorage`) goes in `onSettled`, event handlers, or a `clientOnly()` component. `isServer` guards the rest. That includes a signal's first value: `createSignal(readViewport())` gives the server one value and the client another, hydration keeps the server's text, and a later write of the same client value changes nothing, so the page shows the server's value for good. Start empty (`createSignal<T>()`, rendered as a placeholder) and set it in `onSettled`.

## Accessible widgets

Use the native element first: the `popover` attribute for a menu or a tooltip, `<details>` for a disclosure, and a native `<select>`. They bring the keyboard, the focus and the screen reader roles with them. A modal is never a `<dialog>`: `showModal()` puts it in the top layer, which no `z-index` reaches, so a toast or a menu the site shows over it renders below it. It is Kobalte's `Dialog`, a `<div role="dialog">` as in Base UI and Radix, with `preventScroll={false}` and `lockScroll()` from `@visio/scroll` when it opens, so one lock serves Lenis and the native scroll. A widget with no native element (tabs, a select styled in every browser, a combobox) comes from Kobalte, `bun add @kobalte/core@alpha` in the project, never a hand-built one: its 2.x alpha is the Solid 2 line. visio does not ship it. It is an alpha, and each release pins one exact Solid version, so after a Solid update the project waits for the matching Kobalte release.

## Environment

Not Solid's env: Solid's `virtual:solid-env/*` modules are off in a visio site. `src/env.ts` declares every variable with one `defineEnv()` of `@visio/env`, and code imports `env` from it by a relative path; the `env` skill has the rules.

## Middleware

`src/middleware.ts` exports a chain of `(event, next) => Response` functions that front every request: page renders, `/_server` calls and `api()` routes. Write it with `defineMiddleware` from `@visio/router`: `export default defineMiddleware([async (event, next) => { ... }])`, so the parameters need no annotation. `event` is the request event: the request is `event.request`, and `getRequestEvent()` returns the same event. `next()` takes no argument; to pass a different request on, set `event.request` before the call. Headers stay mutable after `await next()`.

## Tests

The site has no test runner. The packages' own suites are bun tests under `packages/*/test`. When a component needs a test, `@solidjs/testing-library` on vitest in jsdom is the stack the Solid plugin expects: render with `render(() => <Comp />)`, query by role, call `flush()` after an event. `@solidjs/diagnostics` adds `captureArtifact()` and budget matchers.

## Removed from 1.x

| Gone | Use |
| --- | --- |
| `createResource` | a memo returning a promise plus `<Loading>` |
| `Suspense`, `SuspenseList`, `ErrorBoundary` | `Loading`, `Reveal`, `Errored` |
| `batch`, `startTransition`, `useTransition` | automatic batching, `flush()`, `isPending`, `latest` |
| `on`, `createComputed`, single-arg `createEffect` | the two-argument `createEffect` |
| `onMount`, `onCleanup` for lifecycle | `onSettled` with a returned cleanup |
| `mergeProps`, `splitProps`, `unwrap` | `merge`, `omit`, `snapshot` |
| `produce`, `createMutable` | draft-first store setters |
| `Index`, `use:` directives, `classList`, `attr:`/`bool:`/`on:` | `<For keyed={false}>`, `ref={dir}`, `class={{}}`, plain attributes |
| SolidStart, `@solidjs/start`, `<FileRoutes>`, `@solidjs/meta` | start mode of `@solidjs/vite-plugin`, `prerender-crawler`, `useHead` |
