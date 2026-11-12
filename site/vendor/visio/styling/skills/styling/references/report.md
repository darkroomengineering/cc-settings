# The style report and the escape hatches

## The report

Every compiler warning is a report finding, and each finding fails the build. The same list shows in three places. The dev server prints it in the terminal each time it changes, with what it does to the build. Each build prints the report and writes `.visio/report.json`. `bun run check` compiles everything without Vite and prints the same report and fails like the build. No option of the plugin or the check turns a finding or an error off; `unsafe` and `visio-ignore` are the only ways out. Errors print in the dev terminal at start and on each save; the dev server keeps serving, and the file with the error fails when a page requests it. In dev, `.visio/app.css` is the readable stylesheet.

- `CLASSES_OVERLAP`: two entries of a class array set the same property, also when one sets it under a condition or a selector. Merge them, or make the difference a `css.recipe()` variant.
- `EDGE_SET_TWICE`: one style writes the same edge physically and logically (`padding` and `paddingBlock`, `marginTop` and `marginBlockStart`), and the stylesheet decides which wins. Spell the edges you mean one way.
- `WILL_CHANGE_STATIC`: `willChange` in a resting style. Set it from a hover or active state, or drop it.
- `CONTENT_VISIBILITY_NEEDS_SIZE`: `contentVisibility: 'auto'` without `containIntrinsicSize`. Add one.
- `VALUE_NEAR_DUPLICATE`: two values within 2px of each other in the same family. Unify on one, or make the odd one a token if the difference is deliberate.
- `COLOR_MATCHES_TOKEN` / `COLOR_NEAR_TOKEN`: a literal colour that is, or nearly is, a token. Use the token.
- `TOKEN_UNUSED`: the variable was pruned from the stylesheet. Use it, remove it, or ignore it while it lands (below). Points at the token in the tokens file.
- `ATOM_HANDWRITTEN`: a generated class like `pis-safe` was typed as a string in a `class` attribute. Move the declaration into `css()` and reference the style key.
- `TARGET_TOO_SMALL`: an element with `cursor: pointer` is under 24px tall or wide at its worst viewport. A `class` array is measured as one box with later blocks winning, and a child with no height of its own takes it from a parent grid's `gridAutoRows` or a parent flex row's height in the same file; otherwise the estimate is padding plus one line of text. Spread `HIT_AREA` from `@visio/styling` into the block: a `::before` grows the target to 44px each way and the layout stays, so the check passes. More padding or a `minBlockSize` changes the layout.

- `RESPONSIVE_NEEDS_SIZES`: a `?responsive` import never reaches an element with a static `sizes` in its file, so every width ships. Render it in that file with `sizes`. When every width is deliberate, put the `visio-ignore` on the line above the import.
- `IGNORE_UNUSED`: a `visio-ignore` directive matched nothing. Remove it.

The report also lists every `unsafe` declaration, separately from the findings. Resolve findings rather than ignoring them; when a value is deliberate, say so with a `visio-ignore` and its reason.

## Escape hatches

Two, both on the record. Use them for the case the rule did not foresee, not to skip the fix.

**`unsafe`** emits declarations as written. Nothing above applies inside it: no unit check, no shorthand rule, no type preset rule, no layout rule, and the report's lint leaves them alone. It holds properties only; put it inside the condition or selector, not the other way round. Values still have to be static. Every unsafe declaration is listed in the report and gets an `unsafe-` class name.

```tsx
details: {
  display: 'grid',
  unsafe: { gridTemplateRows: '0fr', transitionProperty: 'grid-template-rows' },
  '[open]': { unsafe: { gridTemplateRows: '1fr' } },
}
```

**`visio-ignore`** silences one warning or report finding where the report points, with a reason. A comment on its own line covers the key on the next line and everything nested under it; after a value, it covers that line. Only warnings and findings can be ignored; an error is what `unsafe` is for. A directive that matches nothing is itself a finding (`IGNORE_UNUSED`), so remove it once the fix lands.

```tsx
// visio-ignore VALUE_NEAR_DUPLICATE: 15 lines up with the icon font's cap height
paddingTop: dp(15),
```

```ts
// in tokens.ts
colors: {
  // visio-ignore TOKEN_UNUSED: read from JS by the WebGL scene
  glow: '#ffd27a',
},
```

A token that lands before the component that uses it gets the same line with its reason. One line above a group covers every token in it, so a type scale or a theme can land first and the build still passes; remove the line once the components use them, because until then it also hides a new token added to the group:

```ts
// visio-ignore TOKEN_UNUSED: the card and the footer use these, in the next PR
sizes: {
  cardGap: { mobile: 16, desktop: 24 },
  footerHeight: 120,
},
```
