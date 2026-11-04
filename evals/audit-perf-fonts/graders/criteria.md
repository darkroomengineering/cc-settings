---
type: llm
weight: 1
---

The fixture is a Next.js app with no installed dependencies, so nothing can be built or served. It self-hosts one variable font (`public/fonts/Display-Variable.woff2`, weight range 100 to 900, preloaded) while the site uses weights 400 and 650, the `ss01` feature, accented and curly-punctuation characters, and `hyphens: auto`. The font file is a placeholder, not a real font.

PASS if the response:
- lists fonts as a surface in the measurement plan, naming per-file measurements (at least bytes plus one of glyph count, variable axes, OpenType features or hinting) and font bytes or preloads per page;
- connects the font to what the site uses (for example the 400/650 weights, `ss01`, or the characters in the content) or names the font subsetting procedure as the direction; and
- reports no measured byte, glyph or timing number for the font or the page that it could not have measured, listing those as unmeasured or not measurable instead.

FAIL if fonts are absent from the plan, if the response reports invented font measurements or estimated savings as measured, or if it installs dependencies.
