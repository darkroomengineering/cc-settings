---
name: styling
description: How to write styles in this project with @visio/styling. Read before adding or changing any css(), recipe, token, or theme. Covers the API, the fluid scaling rules, what the compiler rejects and why, and how to read the style report.
---

# Styling with @visio/styling

Styles are typed objects compiled at build time into one atomic stylesheet. There is no runtime CSS-in-JS and no CSS modules. The compiler rejects anything it cannot prove static, and every error names the fix.

## The three imports

```tsx
import { css, cssVars, dp, dph, columns } from "@visio/styling";

import { t } from "./styles/tokens"; // the project's tokens, relative path
```

`import '@visio/styling/css'` appears exactly once, in `src/app.tsx`. Never add it elsewhere.

The tokens module is always `src/styles/tokens.ts`. `visio()` turns styling on with no options: no path, no browser targets, no switch that turns a rule off.

## Static styles: `css()`

One `css()` call per file, inline object literal, one property per line.

```tsx
const s = css({
  hero: {
    display: 'grid',
    paddingInline: t.layout.safe,
    fontSize: dp(24),
    width: columns(3),
    color: t.colors.ink,
    desktop: { fontSize: dp(40), width: columns(6) },
    hover: { color: t.colors.accent },
    '::after': { content: '""' },
  },
});

<section class={s.hero} />
<article class={[s.card, open() && s.cardOpen]} />
```

Rules the compiler enforces. The ones marked (typed) are type errors too, so `bun run typecheck` and the editor show them before the build does:

- **Properties are camelCase.** `paddingInline`, not `'padding-inline'`.
- **Lengths need a unit (typed).** `padding: 16` is an error. Use `dp(16)` for a fluid size or `'16px'` for a fixed one. `0` is fine.
- **No multi-value shorthands.** `padding: '8px 16px'` and `border: '1px solid'` are errors; `border`, `transition`, `background` and the other bundling shorthands are typed, and the type error names the longhands. Single-value shorthands like `padding: dp(8)` expand to longhands automatically. To stack children in one grid cell, give each `gridRowStart: 1, gridColumnStart: 1`, not `gridArea: '1 / 1'`.
- **One spelling per edge.** `paddingInlineEnd: dp(64)` next to `padding: 0` writes the right edge twice, once logically and once physically, and the stylesheet's order decides which wins, not yours. The compiler warns (`EDGE_SET_TWICE`); set the edges you mean with one family, `paddingInline`/`paddingBlock` or `paddingTop`/`paddingRight`.
- **No raw at-rules.** `'@media ...'` keys are errors. Use a named condition (`desktop`, `hover`, `dark`, `reduced`) or add one in the tokens.
- **No runtime values.** Signals, props, ternaries, and functions inside `css()` are errors. States go in a recipe or a class array. Numbers that change go in `cssVars()`.
- **Only the tokens module and `@visio/styling` may be imported into styles.** Shared values live in the tokens.
- **Layout transitions are errors.** `transitionProperty: 'width'` or keyframes on `height` fail the build. Animate `transform`, `opacity`, or a registered variable. `display` is the exception: with `transitionBehavior: 'allow-discrete'` it switches once, at the end, so an element can fade out before `display: none`. Put its start values in a `starting: '@starting-style'` condition to fade it in.
- **Hover only through a condition.** A `':hover'` key, or `:hover` anywhere in a selector key, is an error (`HOVER_NEEDS_CONDITION`): on a touch screen a tap leaves it stuck. Use `hover`. For a hover on a parent, add a token condition that starts with the same media query (see "Conditions and selectors"); the tokens fail to load if it does not.
- **Keep the focus ring.** `outlineStyle: 'none'` or `'hidden'`, or an `outlineWidth` of zero, is an error (`OUTLINE_REMOVED`). The reset draws one ring on `:focus-visible`; restyle it under a `':focus-visible'` key with `outlineColor` or `outlineOffset`.
- **`overflow: 'clip'`, not `'hidden'`.** `hidden` makes a scroll container, so `position: sticky` inside it stops working. The compiler warns (`OVERFLOW_HIDDEN`). `clip` does not contain floats or margins: a child's negative margin that `hidden` cropped (a wordmark cut off at the bottom) now makes the box taller, and nothing reports it. On a block box, add `display: 'flow-root'`; a flex or grid box needs nothing. Keep `hidden` only where something scrolls the element from code, or where `resize` needs it, with `// visio-ignore OVERFLOW_HIDDEN: reason`.
- **`SR_ONLY` and `HIT_AREA` come from `@visio/styling`; spread them, never write your own.** `{ ...SR_ONLY }` hides an element from sight and keeps it for screen readers. `{ ...HIT_AREA }` grows a small pointer target to 44 by 44px with a `::before`, keeps the layout, and satisfies `TARGET_TOO_SMALL`. It sets `position: relative`, so spread it first and set `position` after it when the element needs another; it takes the `::before`, so the element keeps `::after` for its own. An `overflow` other than `visible` on the element clips the `::before` to its box, so the target stays small and the check reports it.
- **A control is its element, not its class.** Something you click is a `<button>`, or an `<a href>` when it goes to a page. A button's style on a `<div>` or a `<span>` with a click handler has no focus, no Enter or Space and no role, and lint rejects it (`jsx-a11y`). Never fix that with `role="button"` and `tabindex`, or hide it with `role="presentation"` or `aria-hidden`: lint rejects those too.
- **Touch targets need an `:active` style.** The reset removes the tap highlight and `hover` never applies on a touch screen, so without `':active': { ... }` a tap shows nothing.
- **Form fields need 16px on mobile.** iOS zooms the page into a field whose text is under 16px. Give an `input`, `textarea` or `select` a preset of 16px or more at the mobile screen.
- **A flex or grid item shrinks below its content.** The reset sets `minWidth: 0` on every element, so a long word or a wide child does not push a row past its container. An item that must keep its content width gets `minInlineSize: 'auto'`, the browser's default, which works in flex and grid; `flexShrink: 0` does nothing in a grid. A `<button>` already has it. A grid too wide for mobile stacks there.
- **No smooth scroll-behavior (typed).** `scrollBehavior: 'smooth'` is an error (`SCROLL_BEHAVIOR_SMOOTH`): the router's scroll reset has to land in one step. Scroll from code with `scrollTo()` from `@visio/scroll`, which glides with Lenis or without it.
- **Class arrays are additive.** `class={[s.card, open() && s.open]}` warns when both set the same property, under any condition or selector, because the stylesheet decides the winner, not the array order. Anything that overrides goes in a `css.recipe()` variant. Ternary branches are fine, they are exclusive. The check sees an array written in the `class` attribute only: a class passed to another component through `props.class` is not checked, so never pass a class that overrides one of the component's own.
- **Strict typography.** `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `lineHeight`, `letterSpacing` cannot be set directly. Spread a preset: `...t.type.body`. Overriding a metric after the spread is also an error. Change or add a preset instead.

A warning fails the build like an error. For a case a rule did not foresee there are two ways out, `unsafe` for an error and `visio-ignore` for a warning, both listed in the report: [references/report.md](references/report.md).

## Conditions and selectors

Nested keys, outer to inner. Each screen past mobile (`tablet`, `desktop`, `widescreen`) is a condition by its name. `hover` already includes `@media (hover: hover) and (pointer: fine)`. Theme names (`dark`) and custom conditions (`reduced`) come from the tokens. Pseudo selectors are quoted strings starting with `:`.

```tsx
card: {
  opacity: 1,
  desktop: { opacity: 0.9, hover: { opacity: 1 } },
  dark: { color: t.colors.paper },
  ':focus-visible': { outlineColor: t.colors.accent },
}
```

A colour token at an opacity is `t.colors.ink.alpha(0.3)`, a `color-mix()` of its variable, so it follows the theme too. The amount is a literal from 0 to 1. Never write the `color-mix()` or an `rgba()` by hand, and never add a token for a translucent copy of another.

A theme is `data-theme` on any element, not only `html`: a dark block on a light page is `<div data-theme="dark">`, and every colour token inside it flips. Never give a block a second palette of its own.

The page's own light or dark mode comes from `@visio/styling`, never a store of the site's: `THEME_SCRIPT` in a `<script innerHTML>` in `src/document.tsx` applies the saved or system theme before first paint, `restoreTheme()` once in `onSettled` in `app.tsx` brings the `theme()` signal up to it after hydration, and `setTheme()` or `toggleTheme()` saves the visitor's choice. A visitor who never chose follows the system preference.

**A page with a theme of its own** names it in its meta, never with a `data-theme` effect of its own: `meta: ({ data }) => ({ title, theme: data.theme ?? 'sand' })`, `light` or a theme of the tokens, typed. It wins over the visitor's mode, so hide the light/dark toggle on such a page. Turn it on once in `src/routes.ts`: `export const themes = routeThemes(t)` from `@visio/styling` in `extensions` of `defineRoutes()`, and `declare module '@visio/styling' { interface Register { themes: typeof themes } }`. The tokens need `colors.page`, the page background, in the base palette and in each theme whose background differs: `<meta name="theme-color">` is its value, so remove any `theme-color` tag from `src/document.tsx`. `<html data-theme>` is set before the first paint, after each navigation, and during a page transition the leaving page keeps its own colours.

Selectors with combinators use `&` for the element: `'& > *'` (children), `'.parent:focus-within &'` (an ancestor state), `'& + &'` (siblings). Comma lists like `':active, :focus-visible'` are one atom with a selector list. A `:hover` never goes in a selector key (`HOVER_NEEDS_CONDITION`): use `hover`, or for a parent's hover a token condition that starts with the same media query, `cardHover: '@media (hover: hover) and (pointer: fine) .card:hover &'`. `&` can sit inside `:has()`, `:is()`, or `:not()`: `'.card:has(&)'` styles the card that contains the element, `'&:is(.a &, .b &)'` the element under either ancestor. An `&` in a quoted value (`'&[data-x="&"]'`) or after a backslash is text, not the element. A bare `'.child'` is an error because it does not say which side of the element it is on, in a list or next to a combinator too. Every part except the atom itself is emitted inside `:where()`, so all atoms have the same specificity and the last one in the stylesheet wins. Never rely on a pseudo or ancestor selector to beat a plain declaration.

Container queries are conditions too. Declare `narrow: '@container card (width < 400px)'` in the tokens, set `containerType: 'inline-size'` and `containerName: 'card'` on the parent, then use `narrow: { ... }` like any other condition.

## Fluid scaling

- `dp(n)` is `n` design pixels, the number in the design file. It compiles to `calc(n * var(--dp))`. By default `--dp` scales with the viewport width against the design width (375 mobile and 1440 desktop here), and changes at every screen's start. With `fluid: false` in the tokens, for a client that forbids scaling, `--dp` is `1rem / 16` everywhere: a CSS px at the browser's default text size. Per-screen values still switch at each screen's start, and columns still fill the window. Write styles the same way either way.
- The screens are `mobile` and `desktop`, and optionally `tablet` and `widescreen`; no other name. Every screen but mobile says where it starts: `tablet: { width: 834, height: 1194, from: 600 }`. Each becomes a condition of its name, a key in every per-screen value (`{ mobile, tablet, desktop }`, where `tablet` and `widescreen` are optional and take the nearest smaller screen's value), a clause in `sizes()`, and a point the report measures pointer targets at.
- `dph(n)` does the same against the viewport height.
- `columns(n)` is the width of `n` grid columns including gaps. Use `t.layout.col` for one column, `t.layout.gap`, `t.layout.safe` for the edge margin. A layout grid is `{ ...GRID }` from `@visio/styling`: one track per column of the screen (`--columns`) and the gap between them. On a box as wide as the content, the frame less `safe` on each side, each track is one column; place children with `gridColumn: "span 3"`. Never write `repeat(12, 1fr)` by hand.
- Token sizes (`t.sizes.headerHeight`) are in design px too, so they scale like `dp()`.
- Scaling stops at `layout.maxWidth` (1260 here). Wider windows keep that size, so every page-level container needs `maxWidth: t.layout.frame, marginInline: 'auto'` next to its `paddingInline: t.layout.safe`; full-bleed backgrounds and rules go on an outer element. `viewport.frame` is the same number in JS.

## Variants: `css.recipe()`

The only way to override a property between states. The compiler resolves conflicts by property, later layers win.

```tsx
const button = css.recipe({
  base: { ...t.type.label, color: t.colors.ink },
  variants: {
    tone: { ink: {}, accent: { color: t.colors.accent } },
    pressed: { true: { transform: "scale(0.96)" } },
  },
  compound: [
    { when: { tone: "accent", pressed: true }, style: { opacity: 0.8 } },
  ],
  defaults: { tone: "ink" },
});

<button class={button({ tone: props.tone, pressed: pressed() })} />;
```

A boolean in `when` or `defaults` needs a `true` or `false` option on that variant. An unknown key, variant, or option is a `RECIPE_MALFORMED` error.

## Runtime values: `cssVars()`

Declare a typed custom property, reference it in a style, set it from Solid's `style` prop. Registration makes it animatable on the compositor and readable in JS.

```tsx
const v = cssVars({ progress: { syntax: "<number>", initial: 0 } });
const s = css({ bar: { transform: `scaleX(${v.progress})` } });

<div class={s.bar} style={{ [v.progress.name]: progress() }} />;
```

An `undefined` value leaves the variable at its `initial`, so an optional prop needs no default of its own and no conditional around the object: `style={{ [v.duration.name]: props.duration }}`. The default stays in `cssVars()`.

Animating with anime.js: `animate(el, { [v.progress.name]: 1 })`.

## Values in JS

`t.layout.gap.px()` returns the current pixel value from the viewport store, measured on resize. With `fluid: false` it follows the root font size, read at the same time, so a change to the browser's text size shows after the next resize. `t.colors.accent.value` is the raw colour. `t.colors.accent.ref` is `var(--colors-accent)`. `viewport.width`, `viewport.screen` (the name of the screen in effect) and `viewport.subscribe()` come from `@visio/styling`.

A token referenced only from JS still ships in the stylesheet. The compiler counts every `t.something` it sees, in styles or in code.

## Globals and keyframes

```tsx
css.global({ body: { ...t.type.body, backgroundColor: t.colors.paper } });
const spin = css.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});
```

Globals land in the `base` layer. Keyframes return a name to use in `animationName`.

## Tokens

`src/styles/tokens.ts` is the single source of truth. Add colours, sizes, easings, fonts, type presets, themes, and conditions there. Every theme name and condition becomes a key usable in `css()`. After adding a condition, register it in the `Conditions` interface at the bottom of the file. Until then the condition is a type error in `css()`.

Token variables nobody references are left out of the stylesheet. The report lists them.

Text has a floor: every scaled font size is emitted as `max(calc(n * var(--dp)), 0.75rem)`, so it never renders under 12px. The floor and the report's thresholds (a 320px viewport, 24px pointer targets) are fixed; the tokens have no key for them. Keep line heights unitless and tracking in em so a preset keeps its shape at the floor.

## Class names

Atoms are readable: `pis-safe`, `w-dp40`, `desktop-w-col6`, `hover-c-accent`. Never write these by hand; the compiler warns when it sees one in a string, and they change when the style changes. In devtools every rule links back to the `.tsx` line that wrote it.

## More

- [references/report.md](references/report.md): what each report finding means and its fix, and the two escape hatches, `unsafe` and `visio-ignore`.
- [references/fonts.md](references/fonts.md): fonts in the tokens, subsets, preloads, variable axes, and the matched fallback.
- [references/images.md](references/images.md): `sizes()` from the layout for an `<Image>`.
