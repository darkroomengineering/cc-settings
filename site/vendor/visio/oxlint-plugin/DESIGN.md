# @visio/oxlint-plugin: design

The project's conventions as lint rules. An agent writes the code, and a rule that lives only in a doc reaches it only when it reads that doc. A lint finding reaches it in the editor and in `bun run lint`, at the line, with the fix. So every message names the fix and the doc to read.

## What goes where

- **Types** catch what TypeScript can express: a route pattern that disagrees with the table, a missing `alt`, a wrong prop.
- **The styling compiler** owns the meaning of styles: units, shorthands, runtime values in `css()`, class arrays, the style report, and `visio-ignore`. It already knows the tokens and the stylesheet, so a lint rule would repeat it with less information. Do not copy a compiler check into lint.
- **Lint** owns conventions: which file may import what, how images and SVG enter a page, what a preload returns, where the stylesheet import goes, what the `style` prop may set, the `server-only` marker, and secrets in the public env. They are rules about the shape of a file, not about what a value means.

## Rules

| Rule | Where (in each app) | Checks |
| --- | --- | --- |
| `control-element` | `src/**` | `role="button"` on anything but a `<button>` and `role="link"` on anything but an `<a>`. A press handler (`onClick`, `onKeyDown`, `onPointerUp`, ...) on an element that `role="presentation"`, `role="none"` or `aria-hidden` takes out of the accessibility tree, and `onDblClick`, `onAuxClick`, `onPointerDown`, `onPointerUp`, `onTouchStart` or `onTouchEnd` on an element that is not a control and has no role. |
| `no-raw-img` | `src/**` | `<img>`, `<picture>`, `<source srcset>`; `<Image>` from `@visio/image-optimizer` renders them. |
| `no-inline-svg` | `src/**` | `<svg>` in JSX; one of defs alone gets a message that names `?defs`. |
| `no-native-scroll` | `src/**` | `scrollTo`, `scrollBy` or `scroll` on `window`, `globalThis`, `self`, `document.documentElement` or `document.scrollingElement`, and `scrollIntoView({ behavior: 'smooth' })`. A jump, a nested scroller, and `scrollTo` imported from `@visio/scroll` are allowed. |
| `style-prop-vars` | `src/**` | `style` on an element is an object keyed by `[v.x.name]` of a `cssVars()` result. |
| `stylesheet-once` | `src/**` | `import '@visio/styling/css'` outside `src/app.tsx`. |
| `no-visio-disable` | `src/**` | An `oxlint-disable` or `eslint-disable` comment that names a `visio/*` rule, or names no rule at all. |
| `ref-callback` | `src/**` | `ref={x}` where `x` is a `let` or `var`. `ref={(el) => (x = el)}` is the form. |
| `preload-returns` | `src/pages/**` | `preload: () => void x()`, and a block preload that calls a relative import, at any depth, and returns nothing (`return null` counts as nothing). |
| `no-preload-query` | `src/pages/**` | A read of `location.query` in a preload, also `{ location: { query } }` and `const { query } = location`. |
| `meta-return-type` | `src/pages/**` | A function outside a component that reads an import from the route table (`../routes`, `~/routes`, `../routes/index`) and has no return type, and a read of such an import at the top of the module. |
| `server-only-marker` | `src/server/**` | A bare `import 'server-only'`. |
| `no-public-meta-env` | `src/**` | A read of `import.meta.env.PUBLIC_*`, dotted or computed. `env` from `src/env.ts` is the one way to read a client var. |
| `no-public-secret` | `src/env.ts` | A `client` key that matches `TOKEN`, `SECRET`, `PASSWORD`, `PRIVATE` or `API_KEY`. |
| `restricted-imports` | everywhere, with a map | Banned imports per folder. |

`no-native-scroll` keeps the page scroll in `scrollTo()` from `@visio/scroll`, so a site's code is the same with Lenis and without it. Under Lenis, a native scroll of the page fights the glide, and so does a smooth `scrollIntoView`; without it, a smooth `scrollIntoView` ignores reduced motion. A `scrollIntoView` without `behavior: 'smooth'` jumps, and Lenis follows a jump while it is idle. An element's own `scrollTo` moves a nested scroller, not the page. `@visio/transitions` resets the scroll with `window.scrollTo` on purpose; the rule covers only the apps. The styling compiler already rejects `scrollBehavior: 'smooth'` in `css()`, so the rule does not check it.

A bare `scrollTo()`, `scrollBy()` or `scroll()` is the window's, so `no-restricted-globals` bans the three globals in the same files; a local function of the same name is not a global and passes. A smooth `scrollIntoView` inside a nested scroller (a carousel) fails too: the scroller's own `scrollTo({ left, behavior: 'smooth' })` is the way, and the message says so. `scrollTo()` scrolls the page with Lenis or without it, so a lab case on a ground without `<SmoothScroll>` scrolls natively.

`ref-callback` makes the callback the one form of an element ref. oxlint's `no-unassigned-vars` reports `let arc; <div ref={arc}>` as a variable that is always undefined: Solid's compiler assigns it, but the rule cannot see that, and its message names no fix. Turning `no-unassigned-vars` off would lose it everywhere else. So this rule reports `ref={x}` (also `x!` and a cast) whenever `x` resolves, through the scope, to a `let` or a `var`, with or without a value, and its message names the callback form that the `solid-2` skill gives. A parameter or a `const` of the same name (a directive, `ref={autofocus}`) passes. When the variable is `el`, the message names the parameter `node`, so the suggested callback does not assign the parameter to itself.

`preload-returns` flags only a call of a function imported from a relative module (a query in `src/lib/`), bare or through a namespace import (`content.getDoc()`). `httpStatus(404)` or a push to a log returns nothing on purpose. `no-preload-query` is there because Solid Router's `location.query` can be stale during a navigation. It is a `createMemoObject`: `in`, a spread and `Object.keys()` read one memo of the whole query, and a property read makes a memo for its key the first time and keeps it. In the router's first preload call, the one the navigation waits for, the whole-query memo and every key memo that already exists still have the query of the page the navigation leaves. Only a key read for the first time sees the new URL. So `'chain' in location.query` and `location.query.chain` both gave the old answer, the second one after an earlier visit had read the key, and the preload started a different set of reads in the call that counts (`packages/router/DESIGN.md`, Dependent reads). `location.search` is a plain value of the new URL. The rule checks the preload's own body and parameters: a preload passed by name (`preload: load`) and a helper it calls are not checked. Outside a preload the object catches up.

`style-prop-vars` trusts a `cssVars()` result from this file or from a relative import, because a package does not export one.

`meta-return-type` covers a route option or a helper that reads `paths`; `packages/router/DESIGN.md`, Meta, gives the cause. tsc names `route`, `routes` and `paths` in TS7022, not the function to annotate, so the rule names it. The rule finds the reads through the scope of each import from a module named `routes` (or `routes/index`) with a relative or alias path (`./`, `../`, `~/`, `@/`, `#/`), so a renamed import counts and a type-only import does not. It reports the outermost function around a read, up to the first one with a return type, because a declared return type cuts the cycle for everything inside it. A component passes: the default export, and every function whose returns are all JSX or `null` (through `?:`, `&&`, and `||` or `??` with JSX on both sides). tsc does not check JSX attributes to infer a return type, so a link that reads the table makes no cycle, and an annotation there is noise. A condition does count: tsc infers the type of the test of `?:` and of the left side of `&&`, so a read there makes the function no component for the rule. Other functions in the module get no exception: the rule does not follow which of them the route uses. A function that returns JSX on one path and a string on another is no component, so the rule reports it. A read at the top of a page module is an ES module cycle: `src/routes.ts` imports the page's `route`, so the table does not exist yet. The rule reports that read too.

`restricted-imports` takes the whole map in one option, `{ zones: [{ files, except, imports }] }`. A later oxlint override replaces a rule's options for the files it matches, so a second `no-restricted-imports` for `pages/` would drop the React ban there. One rule with one map has no order to get wrong. A plain name also bans its subpaths; a relative import is matched as written, so its glob starts with `**`. The globs are relative to the directory of the oxlint config, as in `files`. The option has a full schema: a misspelt key (`excpt`), a missing `message`, or a string where a list goes stops oxlint with a config error. Without the schema, a typo in `except` did nothing, and the ban covered the file it was meant to leave alone.

`test/escapes.test.ts` lists every escape in `oxlint.config.ts` and the preset it extends: each `except` of a zone, each override that turns a `visio/*` rule off with any off severity (`'off'`, `'allow'`, `0`, alone or first in a list), each override that sets `visio/restricted-imports` again (it replaces every zone for its files; today there is none), and each entry of `ignorePatterns` (it skips every rule). A new escape fails the test. To add one, change the list in the test on purpose, so a review sees it. An escape is a decision, not a fix for a lint error. For this reason, `no-visio-disable` stops a comment in a page or a component from making the escape where the test cannot see it. It reports a comment that names a `visio/*` rule, and a bare one without rule names, because a bare one turns off every rule. A comment that names only other rules (`solid/no-innerhtml`) is allowed.

The rule reports at the line of the comment, and oxlint applies the comment to that report too. So a comment that names `visio/no-visio-disable`, a bare `oxlint-disable-line`, and a bare block at the top of a file also turn off the report about them. Only a bare `oxlint-disable-next-line` still shows in lint. RuleTester ignores disable comments, so the rule's suite does not show this. `test/disable-comments.test.ts` closes the gap: it reads every source file in `site/src` and `lab/src`, gives each disable comment to `disableFindings()`, the parser the rule uses, and fails with the file, the line and the rule's message. The rule stays for the message in the editor.

Some bans stay in oxlint's own rules, in the preset's `src/**` override: `requestAnimationFrame`, `scrollTo`, `scrollBy` and `scroll` as globals (`no-restricted-globals`), and `requestAnimationFrame` on `window` or `globalThis` (`no-restricted-properties`).

The same override turns on oxlint's `jsx-a11y` plugin, so a control is the element that behaves like one. A class makes a `<div>` look like a button, but only a `<button>` takes focus, fires on Enter and Space, and is announced as a button. `no-static-element-interactions` and `click-events-have-key-events` report a click or key handler on a `<div>` or a `<span>`. Their help says to add a role, and with `role="button"` `interactive-supports-focus` then asks for a `tabindex`: the same hack with more code. `control-element` reports `role="button"` on anything but a `<button>` and `role="link"` on anything but an `<a>`, and names the tag. It also closes two ways past the jsx-a11y rules. A handler on an element with `role="presentation"`, `role="none"` or `aria-hidden` passes them, though it is a control no screen reader finds. And they read only `onClick`, `onMouseDown`, `onMouseUp` and the key handlers, so `onPointerUp` or `onDblClick` on a `<div>` passes. `control-element` reports only those cases, so a plain `<div onClick>` is not reported twice. A drag surface keeps `onPointerDown` once it has the role of what it moves (`role="slider"`), a `tabindex` and a key handler.

The plugin's other rules run at the project's category levels, with three changes. `prefer-tag-over-role` is off, because it names `<dialog>` for `role="dialog"`. A modal is a `<div role="dialog">`, as Base UI and Radix render it: a `<dialog>` opened with `showModal()` goes in the top layer, which no `z-index` reaches, so a toast or a menu the site shows over it renders below it, and it still needs `lockScroll()`. `label-has-associated-control` is off, because it reads only React's `htmlFor`. Its fix is a `jsx-a11y` setting, and oxlint does not read `settings` from an extended config, and an override cannot hold them. `no-redundant-roles` allows `role="list"` on `<ul>` and `<ol>`, because the reset removes the markers only from such a list, and Safari stops announcing a list without markers unless it has the role.

## Internal entries

A package entry that only visio's own packages import sits under `./internal/`: the Vite plugins, the middleware chain of `visio()`, the compiler's runtime, and the like. `@visio/gate` has no public entry at all: it is switched by `SITE_PASSWORD`, so a project never imports it. One zone bans `{@visio/*,visio}/internal/**` in the apps and the Studio, so a new internal entry is banned the day it is added, with no list to keep. The second segment still says where the code runs, so Node build code and browser code stay in separate files. Every other subpath is public on purpose, and `PUBLIC` in `test/entries.test.ts` lists them. The test fails on a new subpath that is neither under `./internal/` nor on that list, so an entry is internal or public by a decision, not by its name. The decision is who the export is for, not who imports it today: an export a project should never reach for is internal even when nothing in the repo calls it. Before 2026-10-07 each internal entry had its own ban, and most had none.

## Naming

The naming rules of the packages are in `AGENTS.md`, Naming. `test/naming.test.ts` reads every `packages/*/src` file and fails on a message whose `[prefix]` is not the npm name of its package, on a component on a package entry whose `<Name>Props` the entry does not export, and on a diagnostic code that starts with its predicate (`NO_`, `UNKNOWN_`, `UNUSED_`, `MISSING_` and the like) instead of its subject. The rest of the rules (what `define*` returns, the type suffixes) need a reader, not a regular expression.

## The preset

`@visio/oxlint-plugin/config` exports `preset({ apps, zones })`. It returns an oxlint config for `extends`: the plugin, its rules with their files, the bans in oxlint's own rules (above), and the zones of `restricted-imports`. `apps` lists the app folders from the config's directory. The default `['.']` is a project with `src/` at its root. For `'.'`, a zone for the whole app covers `src/**` and `vite.config.ts`, not `**`, so a `studio/` or `scripts/` beside the app keeps its React and its Sanity client. `zones` adds zones after the preset's own. The preset has no option to make an exception: an app that renders Portable Text does it in `src/ui/rich-text.tsx`, as the site and the lab do. The root `oxlint.config.ts` of visio is `preset({ apps: ['site', 'lab'], zones })`, with its own zones for `packages/` and `studio/`.

A project that links the packages adds `@visio/oxlint-plugin` and `oxlint` to its devDependencies, and writes:

```ts
import { preset } from "@visio/oxlint-plugin/config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [preset()],
  ignorePatterns: [
    "**/*.gen.*",
    "dist",
    ".visio",
    "sanity.types.d.ts",
    "vendor/visio",
  ],
});
```

oxlint does not read `ignorePatterns` from an extended config, so the generated files go in the project's own. A second `visio/restricted-imports` in the project's `rules` or an override replaces every zone of the preset; pass more zones to `zones` instead.

Every message names a doc by a path that exists in visio and in a linked project: a skill as `.claude/skills/<name>/SKILL.md` (`visio:update` links the package skills there in a linked project, as visio does by hand), or this file as `node_modules/@visio/oxlint-plugin/DESIGN.md`. The root `package.json` depends on this package for that path. `test/message-paths.test.ts` fails on a path in another form, on a path that does not exist, and on a skill that is not a symlink into `packages/*/skills/`: a skill that lives only in `.claude/skills/` does not travel to a linked project.

## Loading and tests

oxlint loads `src/index.ts` as a JS plugin (`jsPlugins` in the preset, by absolute path). The plugin is TypeScript: oxlint runs on Node, and Node 22.18 or later strips the types, as it does for the config. Relative imports keep their `.ts` extension for that reason. The JS plugin API is alpha, so `oxlint` stays on one minor: a `~` range in the root catalog, and the same range as this package's peer; a new minor can change the rule context or the AST.

oxlint exports its rule and AST types only through `RuleTester`, so `src/types.ts` reads them off its signature. The suites are `test/*.rules.ts` on `RuleTester` from `oxlint/plugins-dev`. That tester refuses to run on Bun (it parses through a buffer transfer Bun does not support), so the suites run on Node's test runner, and `test/rules.test.ts` starts it from `bun test`.
