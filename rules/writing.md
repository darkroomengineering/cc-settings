---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.mdx"
  - "**/*.html"
  - "**/*.astro"
  - "**/*.vue"
  - "**/*.svelte"
  - "content/**/*"
  - "messages/**/*"
  - "locales/**/*"
---

# Writing

> Copy that a person would write about this product, not copy any generator would write about any product. Applies to UI copy, landing pages, emails, PRs, and Slack. Ideas adapted from [deslop-skills](https://github.com/kmaida/deslop-skills).

Readers spot generated copy within a sentence, and once they do they stop trusting the product. The cure is specifics: what the product does, for whom, with what proof. Every pattern below is a way of saying nothing while sounding like something.

## Start from facts, not adjectives

Before writing a headline, collect what is actually true: what the product does in one plain sentence, who it is for, one number or example the user has given you, and what it replaces. If the user has not given you these, ask (AGENTS.md "Ask Through the Question Tool"). A placeholder like `[real customer quote]` is better than an invented one.

- Name the thing. "Turns a Figma frame into a Next.js page" beats "powerful design-to-code workflows."
- Show the result. "Your invoice is sent before the call ends" beats "a seamless experience."
- Use real numbers, and only real ones. Never invent stats, customers, logos, testimonials, or quotes; that is fabrication, not copywriting.
- Write in the product's own voice. If the brand has a writing guide, it wins over this file.

## Structures that read as generated

- Contrast reveals: "It's not X. It's Y." / "Not just X, but Y." / "No X. No Y. Just Z." Say what it is.
- Self-answered questions: "The result? Faster builds." State the result.
- Teasers that withhold the point: "Here's the part nobody tells you." Delete the teaser and give the point.
- The verb-pair headline: "Ship faster. Build smarter." Once is tolerable; as every heading it is a template.
- Groups of exactly three by reflex (three benefits, three adjectives, three cards). Use the number the content has.
- The same rhythm everywhere: every section is eyebrow, headline, gray subhead; every sentence the same length; every paragraph topic, example, transition.
- Repeated openers for build-up: "It means X. It means Y. It means Z."
- Kicker endings and zoom-outs: "That's it. That's the fix." / "The future of X is here." End on the last concrete point.
- Trailing fake-meaning clauses: "..., highlighting our commitment to quality." Replace with the actual consequence, or cut.
- Headings that tease or decorate ("Why does this matter?", "A closer look", "The bigger picture"). A heading states what its section says.
- Bold-label bullets (`**Fast.** Builds in seconds.`) as the default list shape. Write the sentence.
- Manufactured candor and self-annotation: "Honestly,", "To be clear,", "This is deliberate." Just say the thing.

## Words that signal filler

Replace with what you mean, or cut the sentence:

- Marketing reflexes: supercharge, unleash, unlock, elevate, empower, streamline, revolutionize, transform, game-changing, cutting-edge, next-level, effortless(ly), seamless(ly), blazing fast, 10x, "take it to the next level", "built for the modern X".
- Generated-prose vocabulary: delve, tapestry, testament, vibrant, pivotal, crucial, robust (outside engineering), leverage (as a verb), utilize, harness, foster, navigate (figurative), landscape (figurative), ecosystem (figurative), journey (figurative), realm.
- Empty openers: "In today's fast-paced world", "Whether you're a X or a Y", "When it comes to", "At its core", "Imagine a world where".
- Intensifiers that hedge: very, really, truly, genuinely, incredibly, basically, essentially.

A word on this list is fine when it is literal ("a robust retry policy", "the npm ecosystem").

## Punctuation and casing

- No em dashes in copy. Restructure with a comma, colon, parentheses, or a new sentence; a spaced hyphen standing in for one is the same tell.
- Straight quotes in code and markdown; typographic quotes only when the design system sets them deliberately.
- One casing convention across headings, buttons, and labels: sentence case unless the brand says otherwise.
- Exclamation marks almost never. Emoji only when the brand voice uses them, never as bullets.

## Check before you hand it back

Read the copy and ask: could this paragraph sit on a competitor's site unchanged? If yes, it has no facts in it yet. Add the specific thing, or ask the user for it.
