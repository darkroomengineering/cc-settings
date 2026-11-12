# Fonts

Fonts live in the tokens. A source with `subset` is subsetted to that range at build time, re-encoded as WOFF2, shipped through Vite, and referenced from the `@font-face` rule; the path is relative to the project root and must be an OTF or TTF. A source without `subset` is used as written. `t.fonts.mono.url` is the shipped URL of the first file as a plain string, for a preload in the document or WebGL text; `t.fonts.mono.urls` has one per file, in source order and then subset order.

```ts
fonts: {
  mono: {
    family: 'Server Mono',
    fallback: 'ui-monospace, Menlo, monospace',
    sources: [{ src: 'src/assets/fonts/ServerMono-Regular.otf', weight: 400, subset: 'latin', display: 'optional' }],
  },
  sans: {
    family: 'Host Grotesk',
    fallback: 'Arial, sans-serif',
    sources: [
      { src: 'src/assets/fonts/HostGrotesk-Variable.ttf', subset: ['latin', 'latin-ext'], axes: { wght: 400 }, weight: 400 },
      { src: 'src/assets/fonts/HostGrotesk-Variable.ttf', subset: ['latin', 'latin-ext'], axes: { wght: 700 }, weight: 700 },
    ],
  },
},
```

- `subset`: a preset (`latin`, `latin-ext`, `cyrillic`, ...), `{ unicodeRange }`, `{ chars }`, or `used`. Default to a preset. `used` is printable ASCII plus every other character written in the source files and nothing else: text that arrives from a CMS never passes through the compiler, so with `used` its accented letters, dashes, and quotes render in the fallback font. Choose `used` only when every string on the site ships in the repo.
- A list of presets, `subset: ['latin', 'latin-ext']`, ships one file per subset, as Google Fonts does. Each file gets its own `@font-face` with the same family, weight, style and display and its own `unicode-range`, so the browser loads a file only when the page draws a character in its range. Each preset is Google's exact range, so `latin-ext` has no ASCII: a source with `latin-ext` needs `latin` in its list, or another source of the same weight and style that draws ASCII, else the build fails. `used` cannot go in a list, an empty list fails, and `axes` needs `subset`; all three are type errors in the tokens file.
- Preload the one file that the first screen draws: `t.fonts.mono.url` is the first, `t.fonts.mono.urls[i]` any other (a title in the 800 weight is the second source in `[400, 800]`). A preload of more files loads them on every page, whether the page needs them or not.
- `axes` pins the named axes of a variable font; with every axis pinned the source is one static instance, so write one source per weight you use. Leave it out to ship the variable font whole and give `weight` its range (`'300 700'`).
- The first family in `fallback` with known metrics (Arial, Helvetica, Helvetica Neue, Segoe UI, Roboto, Verdana, Trebuchet MS, Times New Roman, Georgia, Courier New, Menlo, Monaco; not `ui-*`) is emitted as a second `@font-face` sized to the web font, one for each weight with an upright local source, so the page keeps its line breaks while the fallback shows. A weight range (`'300 700'`) gets one face with no weight, so the browser fakes a bold from it. A weight of 600 or more is sized against the family's bold face (`local("Arial Bold")`); Menlo and Monaco have no bold row and keep the regular face. `adjust: 'Menlo'` picks one explicitly and fails if it is unknown; `adjust: false` turns it off.
- `display: 'optional'` is the right setting for a preloaded subset: it is used when it arrives within the first moments, which an 8 kB preloaded file does, and otherwise the page stays on the matched fallback with no swap at all. `block` hides text instead.

Use a font with linear metrics. macOS system fonts (`system-ui`, `-apple-system`) change their tracking with the pixel size, so text wraps differently as the page scales even though every box scales exactly.
