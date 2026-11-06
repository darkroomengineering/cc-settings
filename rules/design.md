---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.html"
  - "**/*.astro"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.css"
  - "**/*.scss"
---

# Design

> Interfaces that look like this product, not like the page every generator produces. Copy rules are in `rules/writing.md`; motion values in `rules/motion-physics.md`. Ideas adapted from [deslop-skills](https://github.com/kmaida/deslop-skills).

The test for every element on screen: does it carry information or serve this context? A chevron that opens something, a status pill that maps to a real state, a dark theme for a product used at night: keep them. The same elements added because they "look like a SaaS page" are the problem. Do not strip real affordances to avoid looking generated; a flat ban list applied blindly is its own failure.

## Building from a design

When the page comes from Figma or Paper frames, build the latest version exactly: its copy, its elements, its order. List the frame's text and elements before you start. Never invent copy, never re-add something the designer removed, and never add a section the frames lack; anything beyond the frames needs the user's OK. The brief and the tells below are for pages with no design. On a designed page, mention a tell to the user once instead of changing the design.

## Write the brief before the first section

A distinctive page comes from decisions, and generators skip them. Before building a landing page or a new marketing surface, write down (in the plan or a comment to the user, not in the code):

1. Who it is for, and what they are trying to do when they land.
2. The one claim the page has to prove, in a plain sentence.
3. The proof the user actually has: screenshots, real output, a demo, real customers or numbers. Sections without proof behind them do not ship.
4. One visual idea that comes from the product: its material, its output, its domain, its brand. A tool for printers might set type like a press sheet; a finance tool might lead with a real ledger. Not "dark with a gradient".
5. Type, color, radius, and density, each chosen deliberately. A component library's defaults are a starting point, not a decision.

If the user has not given you 1 to 3, ask before building (AGENTS.md "Clarify Before Full Work Mode"). Never fill gaps with invented logos, testimonials, avatars, or stats; mark them as placeholders the user must replace.

## The templated landing page

Each piece can be defended alone; together they form the page everyone has seen:

- a badge pill above the hero ("✨ New: v2 →") with nothing real to announce
- centered headline, centered gray subhead, two buttons side by side
- the same section anatomy repeated: small colored eyebrow, big centered heading, gray subhead, grid
- a three-up feature grid with an icon on top of each equal-weight card
- "How it works" as numbered circles joined by a line
- a stats band (uptime, requests, countries), often counting up on scroll
- a pricing table with a highlighted "Most popular" middle tier
- a logo marquee, avatar stack, or five-star row standing in for real proof
- a bento grid where every tile has the same weight
- an FAQ accordion and a four-column footer link farm as filler

When three or more appear together, rebuild the page around the brief: order sections by the argument, vary alignment and section shape, give the most important thing the most space, and cut sections with nothing real in them.

## Almost always reflex

- Gradient text on the headline (`bg-clip-text text-transparent`). Use a solid color and let type carry the weight.
- Purple-to-blue or neon-on-dark palettes, glow shadows under buttons, spotlight radial glows, blurred color blobs behind the hero, dot or grid backgrounds fading out. A background either says something about the brand or stays plain.
- Glassmorphism by default. Keep blur for surfaces that really sit over moving content.
- A colored accent bar on one side of cards or rows. Show state with a label, a tint, or a dot that maps to something.
- Cards inside cards. Flatten and group with space and type.
- One large radius on everything and pill buttons everywhere. Pick a radius scale; some things are square.
- Small all-caps letter-spaced eyebrows on every section. Fine as a real brand convention, a tell when sprinkled.
- The icon set Zap (fast), Shield (secure), Sparkles (AI), or emoji on top of feature cards. Use icons that encode something specific to this product, or none.
- Pulsing "live" dots, decorative sparklines and gauges that measure nothing, `⌘K` hints for shortcuts that do not exist.
- Stock or generated lifestyle photos where the product should be. Show the real product or its real output.
- Fade-in-up on every section on scroll, and `transition-all`. Default to static; animate the moment that earns it (`rules/motion-physics.md`).
- The same generous padding on every surface. Dense where people work, spacious where they decide.
- The unmodified component-kit look: zinc grays, muted gray text, a thin border on everything, the default font, no color commitment. The tell is that no decision was made.

## Fine when they mean something

Icons beside nav items, chevrons on rows, status pills, checkmark lists, an arrow on the primary CTA, hover lift on clickable cards, relative timestamps, progress rings, a dark-mode toggle. Keep each when it encodes a real category, state, comparison, or action; cut it when it is texture.

## Reviewing

Report each tell as `file:line - tell - fix`. For the templated landing page, report the pattern once and list its pieces rather than filing one finding per section. End with the question: shown this page and told an AI made it, would anyone be surprised? If not, the brief was skipped.
