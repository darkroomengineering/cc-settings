# The smoke run

A page that logs errors is broken, and its numbers mean nothing. The browser console, the dev server's output and the rendered HTML say so, but nobody reads them when no tab is open. `bun run smoke` reads them for you:

```bash
bun run smoke                              # start the dev server on a free port, check every page
bun run smoke --url http://localhost:3000 --only /,/404
```

It crawls the dev server the way the build crawls the built server (prerender-crawler: `/`, the pages `announceRoutes` names, every same-origin link), with `live` routes and without `api()` routes and the Studio. Then it loads each page in headless Chrome until the network is quiet. Each finding names the page, the kind, the message, and the file and line when a stack or the server gives one (mapped through the dev server's source maps):

- `console`, `diagnostic`, `exception`, `log`: console warnings and errors, Solid's `[CODE]` diagnostics (look the code up in `reactivity-diagnostics`), uncaught errors, unhandled rejections, hydration warnings.
- `request`: a failed request or an answer of 400 or more.
- `server`, `diagnostic`: what the dev server printed while it rendered or served the page.
- `boundary`: a `<Loading>` boundary the server HTML never completed (the build's guard, `inspectBoundaries`).
- `status`, `link`: a page that answers an error, and a link to a path that is a 404.
- `head`: after the page loads, a click to another crawled page and back does not bring back its head (the title and every tag the head registry owns), or the trip could not run. It runs once, on the first page that links to another one, in a tab of its own. With one page (`--only /x`), or no page that links to another, it does not run, and the run prints a note, not a finding.
- `agent`: the page's Markdown copy (`/path.md`) does not answer as Markdown, or words appear only after JavaScript runs, which AI crawlers never read (the `aeo` skill).
- `expected`: a page marked a finding with `data-smoke-expect`, and no finding matched it.

It exits 1 on any finding, a warning too. A finding that a page causes on purpose does not count when the page marks a part of its message with `data-smoke-expect` in the server HTML. Never mark a finding to make the run pass: mark it only when the case is there to cause it. It is slow: every page compiles on first request, and a cold app takes minutes on a busy machine. It runs one page at a time, so what the server prints belongs to the page in flight. `CHROME_PATH` overrides the Chrome binary; `CHROME_FLAGS=--no-sandbox` is for a Linux that gives Chrome no sandbox.

The app is `site/` when it has a `vite.config.ts`, else the project root; `bun run smoke <folder>` names another. `bun run visio:update` adds the `smoke` script, unless the project has one of that name.
