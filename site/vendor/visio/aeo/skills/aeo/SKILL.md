---
name: aeo
description: How a visio site serves AI agents and answer engines with @visio/aeo - the Markdown copy of every page (/path.md and Accept text/markdown), llms.txt, the AI search and training switches of robots.txt, the modified date, and the smoke checks for Markdown copies and content that only JavaScript renders. Read before you change robots.txt or llms.txt, add content that the browser fills in, or when the smoke run reports an `agent` finding.
---

# @visio/aeo

`visio()` wires all of it, on Vercel and on Cloudflare. A site writes no middleware and no file for it. Design and evidence: `aeo/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project).

```ts
// vite.config.ts: both kinds of crawler may crawl by default
visio({ aeo: { search: true, train: false } });

// a page: the date its content last changed (a Sanity document's _updatedAt)
export const route = defineRoute("/journal/:slug", {
  preload: ({ params }) => getPost(params.slug),
  meta: ({ data }) => ({ title: data.title, modified: data._updatedAt }),
});
```

## What an agent gets

- `/path.md` (`/index.md` for `/`) is the page as Markdown: front matter (`title`, `description`, `url`, `modified`), then `<main>`. `curl -H 'Accept: text/markdown' /path` gives the same. Both are cached with the page, under the page's cache tags, so a publish purges them together.
- `llms.txt` lists every indexable page with a link to its `.md` copy.
- A `Link` header on each page names its copy (and `llms.txt` in an indexable build), and on each copy names its page as canonical, so search engines index the page and not the copy. A redirect of `/old.md` goes to the copy of the new page.
- `robots.txt` lets every crawler in. It adds a group with `Disallow: /` for each AI search or training crawler whose switch is off, and a `Content-Signal` line. The line names `ai-train` only when the site sets `train`, so a site that sets nothing states no training preference for its client.
- `llms.txt` and the AI rules come only with an indexable build (`PUBLIC_SITE_INDEXABLE=true`, and on Workers Builds only the production branch). A preview gets neither.

## Rules

- **Content is in the server HTML.** No AI crawler but Google's and Apple's runs JavaScript. Text that a component fills in after hydration is not there for them. Render it on the server, behind a `<Loading>` boundary if it waits on data.
- **Not content: mark it.** A live readout, a cookie notice or a widget that people see but an agent does not need gets `data-agent="skip"`. Pure decoration gets `aria-hidden="true"`, which screen readers skip too. Do not put `aria-hidden` on text that people read.
- **Good HTML is good Markdown.** One `<h1>`, real headings in order, `<ul>`/`<ol>` for lists, `<table>` for tables, `<pre><code class="language-x">` for code, and `alt` text on every image that carries meaning (`alt=""` on decoration). In a `<form>`, a `<label>` for each field, and a `<fieldset>` with a `<legend>` for a group of radio buttons or checkboxes: the copy lists each field with its label, `*` when it is required, and its options, and it reads only that markup.
- **A file in `public/` wins.** A hand-written `public/robots.txt` or `public/llms.txt` replaces the generated one.
- **Keep JSON-LD for Google.** It gives breadcrumbs, the logo and local results in Google Search, so it stays in the page's `jsonLd`. Do not add JSON-LD, FAQ markup or keyword text for AI answers: no data shows that they help there.
- **On Cloudflare, do not turn on "Markdown for Agents"** for the zone. The site already serves its own copy.

## Checks

`bun run smoke` reports these as `agent`:

- `/path.md answered 404 …`: the copy did not come back as Markdown. The page itself failed, or the chain of `visio()` changed.
- `N word(s) appear only after JavaScript runs …`: render those words on the server, or mark them as above.
