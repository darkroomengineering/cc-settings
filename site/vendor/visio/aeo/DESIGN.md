# @visio/aeo design

AEO is short for answer engine optimization. This package makes a visio site easy to read for AI agents and answer engines. The site does almost nothing for it. The package does only the parts that have evidence behind them (research of 2026-10-04, in PR #168):

- No AI crawler except Googlebot and Applebot runs JavaScript. They see only the server HTML.
- Coding agents (Claude Code, Cursor, OpenCode) ask for Markdown with `Accept: text/markdown`. Agents also ask for `.md` URLs, and more often each month. Markdown costs an agent about 80% fewer tokens than HTML.
- robots.txt is the only signal that all large AI companies obey, and only their training and search crawlers obey it.

The package does not add FAQ markup, GEO text fields, an `/ai` page or a manifest. It also adds no JSON-LD for AI answers: Ahrefs compared 1,885 pages that added JSON-LD with matched pages and found no gain in citations, and Google says that AI features need no special markup. This is not a rule against structured data. JSON-LD still gives Google its breadcrumbs, the site's logo and the local business results. A page keeps that JSON-LD in the `jsonLd` of its meta (`@visio/router`). The package does not log bot traffic: Vercel Observability and Cloudflare's analytics show it.

## What a site gets

`visio()` adds all of this to every site. No option removes it (`visio/DESIGN.md`, Goals).

| Part | Where | How |
| --- | --- | --- |
| A Markdown copy of each page at `/path.md` (`/index.md` for `/`) | dev, Vercel, Cloudflare | `markdown` in the middleware chain of `visio()` |
| `Accept: text/markdown` on a page path gets the Markdown copy | dev, Vercel, Cloudflare | the same middleware, and the routes in front (below) |
| `Vary: Accept` on every page answer | dev, Vercel | the same |
| A `Link` header on each page to its copy and `llms.txt`, and on each copy to its page | dev, Vercel, Cloudflare | the same |
| `llms.txt`, one line per indexable page with a link to its `.md` copy | an indexable build only | a crawl integration |
| The AI crawler rules in `robots.txt`, and a `Content-Signal` line | an indexable build only | rules that `@visio/router` writes into its file |
| `article:modified_time` and the sitemap's `lastmod` from `meta.modified` | every build | `@visio/router` |

A site sets one thing at most: `visio({ aeo: { search, train } })` (below). A page whose content has a date sets `modified` in its meta.

## The Markdown comes from the HTML

The middleware converts the page's server HTML. It does not render the page a second time. Solid's server output is compiled string templates, so a Markdown renderer would need a third compile of the whole app. The HTML is also what crawlers read, so the two copies cannot differ. The converter is a small tokenizer with no DOM (`src/html.ts`), because the input is always visio's own server output.

- **Root:** `<main>`, or `<body>` when there is no `<main>`, so the site's nav and footer stay out. Inside it, the converter leaves out `nav`, `script`, `style`, `noscript`, `template`, `svg`, `canvas`, `iframe`, `dialog`, buttons, and form fields outside a `<form>` (Forms, below).
- **Left out on purpose:** an element with `hidden`, `aria-hidden="true"` or `data-agent="skip"`. `aria-hidden` is correct for decoration in any case. `data-agent="skip"` is for content that people see but an agent does not need, such as a cookie notice or a live readout. A list item with no text is left out, and so is a list with no items left: a carousel of image buttons has controls and decoration, not content.
- **Streamed boundaries:** a cached page renders in order (`visio/DESIGN.md`, In-order pages), so its HTML has no placeholders. A `live` page streams. There, a `<Loading>` boundary that was pending when the shell flushed leaves `<template id="pl-KEY">`, then its fallback up to `<!--pl-KEY-->`. Its content comes at the end of the stream in `<template id="KEY">`. The converter puts that content where the fallback was, as the browser does. So the Markdown has the data and not "loading…".
- **Links and images** become absolute against the page's canonical URL, or against the request URL when there is none. An image with `alt=""` is decoration, and the converter leaves it out.
- **Forms.** An agent cannot send a form, but what it asks is content ("what do I need to book a call"). A form keeps its text, and each field becomes one list item: its label, `*` when the control has `required` or `aria-required="true"`, and the options of a `<select>` or of a `<fieldset>` of radio buttons or checkboxes (its `<legend>` is the label). A field takes its label from a `<label>` around it or with its `for`, also in another box, else from `aria-label` or `placeholder`. The parts of a label get a space between them, so help text stays apart, and a `*` that stands alone in the label of a required field goes, so a required field has one `*`, after the label and its help text. Buttons, hidden inputs, an `<option>` with an empty `value` or `disabled`, and a control in a hidden box stay out, with its label. The mark is `*` and not a word, so it needs no language: a word in English would be wrong on a page in another language, and a table of translations is not this package's job. Radio buttons outside a `<fieldset>` become one field each, so the skill asks for the `<fieldset>`.
- **Links that touch.** The converter does not see CSS, so a row of buttons laid out with `gap` has no text between its links. A run that holds only links with text, two or more, becomes a list. A link alone inside an inline element, such as a button's wrapper `<span>`, counts as that link. Two links that touch inside other text get a space, also when one of them is inside a wrapper. Other elements that touch get nothing: animated text often puts each letter of a word in its own `<span>`.
- **Text that Markdown would read as markup** (a heading, a quote, a list item, `<`) is escaped.
- **Front matter:** `title`, `description`, `url` and `modified` from the head, as YAML. The page's own `<h1>` stays the first heading.

## How the copy is served

**The middleware.** `markdown` answers `GET /path.md`, and `GET /path` whose `Accept` names `text/markdown`, for a path where the route table has a page: a match that is not the catch-all (`isPage()` of `@visio/router`). Every other request goes down the chain as it came. So an `api()` route keeps its answer whatever `Accept` says, and `/api/feed.md` gets the 404 page. `visio()` puts it in the chain after `settleCrawl` and Vercel's cache, and before Sanity's routes and the site's own middleware. So the reads of a copy tag the cache, and the site's middleware sees the page request.

- For `/path.md` it puts a request for `/path` with `Accept: text/html` on the request event, then calls `next()`. Since `@solidjs/vite-plugin` 3.0.0-next.49 (#222), a middleware gets the request event, and `next()` takes no argument. To hand a different request down the chain, a middleware assigns `event.request`. The render and the API routes read the request there. PR #168 did the same assignment as a workaround, because the router read the event's request and not the request given to `next()`. Now it is the documented way.
- A request that asks with `Accept` goes down the chain as it came. So an API route still reads the `Accept` it was sent.
- It converts an HTML response with status 200. Every other response passes as it is: a 404, a redirect. It adds `Vary: Accept` to every HTML answer at a page path.
- A redirect of a `.md` request goes to the copy of the page that it names: `/old.md` goes to `/new.md` when `/old` goes to `/new`. So an agent that follows it gets Markdown and not HTML. A redirect to another origin, to a path with no page, or to the same copy (`/a` to `/a/`) passes as it is.
- `Link` headers (RFC 8288). An HTML page with status 200 names its copy, `</path.md>; rel="alternate"; type="text/markdown"`, and `</llms.txt>; rel="describedby"` when the build writes `llms.txt` (`SITE_INDEXABLE`, not in dev). The URLs are paths, because a cached page keeps the header of its first render, and the crawl renders on another host. A copy names its page as `rel="canonical"` and as `rel="alternate"; type="text/html"`, with the page's own canonical URL, or the request URL without its query when there is none. The copy of a `noindex` page gets `X-Robots-Tag: noindex` and no canonical, as its page has none (a preview build, a draft). Google obeys a canonical in a header. Without it, Google could index `/path.md`, which `llms.txt` links to, as a second copy of the page. Nuxt SEO's AI Ready module sends the same headers.
- The copy renders in the same request as its page. So the page's cache tags (Sanity's `sanity` tag, `tagCache()`) reach the copy, and a publish purges the page and its copy together. A copy written at build time would stay stale until the next deploy.

`Accept` is read as "names `text/markdown`", with no `q` values. Browsers never send it, and the agents that send it put it first.

**Vercel.** Vercel answers a cached page from its cache before a function runs, so `Accept` alone cannot reach the middleware. So:

- A crawled page's seeded answer gets the `Link` header of its render in `initialHeaders`, so the first answer from the cache has it too.
- Each crawled page gets a second cached function, `path.md` (a link to the one function), with the same expiry and no fallback. Its first request renders it, and the cache keeps it from then on.
- A route ahead of `filesystem` sends a page request whose `Accept` names `text/markdown` to its `.md` path, with `check`. A crawled page's copy is in `filesystem`. For any other path, routing goes on with the `.md` path. Behind a rewrite, Vercel gives the function the address that the visitor asked for, so the middleware sees `/path` with its `Accept`.
- A dynamic route's `.md` paths go to the same `_routes/<n>` function as its pages, under their own `__pathname`. So the page and its copy are two cache entries. The `.md` paths of the `live` pages and the `api()` routes go to the catch-all with the pages, ahead of the dynamic routes.
- A route ahead of the rewrites sets `Vary: Accept` on every page path, also on an answer from the cache. It is for the caches after Vercel. Vercel's own CDN cache already puts `Accept` in its key for a response that it caches by `Cache-Control`, with or without `Vary` (Vercel's "CDN Cache" docs, Vary header). The pages are not cached that way: they are prerender functions, whose cache key is the function's path and its `allowQuery`. The rewrite sends every Markdown request to the `.md` function, so the HTML function gets one entry per page. A preview deploy must still show `x-vercel-cache: HIT` for two browsers with different `Accept` values.
- File paths (a dot in the last segment), the server-function endpoint and the Studio are never rewritten.

**Cloudflare.** The gateway (`default`) sends a cached path to `Render` with a cache key (`cloudflare/DESIGN.md`). A copy has its own key, the `.md` path, whether the request named the `.md` path or asked with `Accept`. The gateway sends `Render` the request that the key stands for: the `.md` path for a copy, and `Accept: text/html` for every page and copy.

- Why not `Vary: Accept` alone: Workers Cache obeys `Vary` for every header name, but it compares the values verbatim. Each browser sends a different `Accept`, so each would get an entry of its own. The gateway reduces `Accept` to two formats, so each key has one entry.
- The copy renders in `Render` with the same reads as its page, so it gets the same `Cache-Tag` values, and `purgeCache()` clears both.
- `Render` removes `Accept` from `Vary` before Workers Cache stores the answer. No cache after the Worker needs it: the browser gets `max-age=0, must-revalidate` and asks the Worker again every time.
- The copy of a `live` page or an `api()` route renders in the gateway, past the cache, as its page does.

Cloudflare has a zone feature, "Markdown for Agents" (Pro plan and higher). It converts HTML to Markdown at the edge for a request that asks for `text/markdown`. Do not turn it on for a site that serves visio's copy. The site already answers with Markdown, and a second converter could give an agent a copy that is different from the one that the checks below test.

**Dev.** The Solid plugin's dev server renders only a request whose `Accept` names `text/html` or `*/*`, and it decides this before any middleware runs. `aeoDev()`, which `visio()` adds, gives a `.md` request `Accept: text/html`, and adds `text/html` to the `Accept` of a request that asks for Markdown.

## Only in an indexable build

`llms.txt` and the AI crawler rules come only with an indexable build, as the sitemap does. They read the one decision that `visio:config` makes: `PUBLIC_SITE_INDEXABLE=true`, which a Workers Builds build of a branch that is not production drops (`cloudflare/DESIGN.md`, "Indexing per branch"). On Vercel, `visio()` does not read `VERCEL_ENV`. Vercel sets environment variables per environment, so a preview is not indexable unless someone sets `PUBLIC_SITE_INDEXABLE=true` for Preview too. A preview gets the plain `robots.txt` and no `llms.txt`: the preview must not tell AI crawlers about itself, and a `Disallow` would hide the `noindex` that every page of it carries.

## llms.txt

`llms.txt` follows llmstxt.org: `# name` (`site.name`, or the home page's title), `> description` from the home page, then `## Pages`, one line for each indexable page with status 200: `- [title](url.md): description`. A site writes nothing by hand. Google ignores the file, and 97% of the files that Ahrefs studied got no requests. It is here because coding agents read it, and it costs about 40 lines. The crawl writes it from the pages that it rendered, and every build crawls. With a route that announces, the deployed server answers it from the same entries and the pages `announce()` gives now, through `llmsText()` (`src/llms-text.ts`, which imports no Node module, `@visio/aeo/internal/llms`; `visio/DESIGN.md`, Live lists). A `public/llms.txt` wins.

## robots.txt

`@visio/router` writes `robots.txt` (`router/DESIGN.md`, Prerender). This package gives the AI rules for it, `robotsRules()`, and `visio()` passes them to the router for an indexable build. The dev server's `/robots.txt` reads the same rules with the same decision. Two switches, `visio({ aeo: { search, train } })`:

- `search` (default `true`): the AI search indexers (OAI-SearchBot, Claude-SearchBot, PerplexityBot) may crawl.
- `train` (default: allowed, and no preference stated): the training crawlers (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent, Bytespider) may crawl.

A switch that is `false` gives each crawler of that kind a group with `Disallow: /`. The `User-agent: *` group always allows everything, and it gets `Content-Signal: search=yes, ai-input=…` from the same switches (Cloudflare's Content Signals; no AI company has said that it reads them, but they cost one line). It names `ai-train` only when the site sets `train`: `ai-train=yes` for `true`, `ai-train=no` for `false`. A site that sets nothing lets the training crawlers in, but does not say "yes" for its client. Nuxt SEO's AI Ready module has the same default. User-triggered fetchers (ChatGPT-User, Claude-User, Perplexity-User) do not obey robots.txt, so the file does not name them. A `public/robots.txt` wins.

PR #168 moved `robots.txt` from the router into this package. This package now gives only the rules, and the file stays in the router: that is the smaller change, and the router also writes the sitemap that the file names.

## Dates

`meta.modified` (ISO 8601) becomes `article:modified_time` in the head, the `modified` field of the front matter and the page's `lastmod` in the sitemap. AI assistants cite newer pages more often than search does, and a true date is the cheap part of that. For a page from Sanity, it is the document's `_updatedAt`.

## Checks

CI runs `scripts/output.ts` after the build. The site's built Vercel function must answer `/` as HTML, and `/index.md` and `/` with `Accept: text/markdown` as Markdown. The copy depends on the request that the middleware puts on the event reaching the render. A Solid update that changes this fails there, not in a unit test.

The smoke run (`bun run smoke`) reads the server HTML of each page and also loads it in Chrome. Two checks come from this package:

- **Markdown copy:** `/path.md` answers 200 with `text/markdown` and has text, on the site and in the lab.
- **Visible without JavaScript:** on the site, the words of the page after hydration, compared with the words of the server HTML, both read with the converter's rules. A word that only the browser renders is a finding, because no AI crawler would see it. A live readout that is not content (the scroll position, what the browser loaded) gets `data-agent="skip"`.

## Not here

- A `<link rel="alternate" type="text/markdown">` in the head. The `Link` header says the same, and costs no bytes in the HTML.
- WebMCP on `formAction()` forms. Chrome's API is in an origin trial, and it changed in July 2026.
- Bot and referral logging. The platforms show verified bots.
