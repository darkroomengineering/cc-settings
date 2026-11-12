# @visio/cloudflare design

Where a visio site deploys on Cloudflare: `cloudflare()` in `vite.config.ts`, given to `visio({ deploy })`. The package holds the output writer and the Worker's runtime. What it shares with `@visio/vercel` comes from `visio/internal/deploy` (`visio/DESIGN.md`, Deploying).

```ts
import { cloudflare } from "@visio/cloudflare";

visio({ deploy: cloudflare() });
```

The supported plan is Workers Paid ($5 a month per account, 2026-10-26). The free plan gives a request 10 ms of CPU and 50 subrequests, and one render of a page that is not cached can take more: 10.8 ms of CPU for a light lab page and 24 ms for the site's home, measured on Node (not in workerd). Workers Paid gives 30 s of CPU by default and 10,000 subrequests (Cloudflare's docs, "Workers limits", "Pricing").

What differs between deployments of one site, such as the Worker's name, comes from the env, never an option. `cloudflare()` takes three options, because they are the same in every deployment of a site: `observe`, a hook after each answer, `bindings`, what the Worker reaches on Cloudflare: another Worker, a KV namespace, a database, an email sender (Bindings), and `observability`, what Workers Logs keeps (Logs).

## The output

`visio({ deploy: cloudflare() })` makes the build a Cloudflare Worker with static assets. Pages is not a target: Cloudflare puts its new work into Workers. After the crawl, the output plugin writes `dist/cloudflare/`. It also writes `.wrangler/deploy/config.json`, which points Wrangler to `dist/cloudflare/wrangler.json`. So `wrangler deploy` and `wrangler preview` in the site's folder deploy the output, and Workers Builds needs no other command. visio writes every key of the config, because the runtime code depends on them, except two. The Worker's `name` must match the Worker in the dashboard. Workers Builds sets `WRANGLER_CI_OVERRIDE_NAME` to that name (Cloudflare's "Troubleshooting builds", "Workers name requirement"). `wrangler deploy` and `wrangler preview` use that name, whatever the config says, and warns when the two differ. So the build writes it into the config too. The name check (`WRANGLER_CI_MATCH_TAG`) runs inside `wrangler deploy`, after the build, against the name Wrangler deploys under. So the site's folder needs no Wrangler file before the build. This comes from Wrangler 4.149's source; a Workers Builds run has not shown it yet. Without the variable the config has no name: Wrangler then uses `wrangler deploy --name <worker>`. When Workers Builds runs the build without the variable, the build warns. Custom domains are set in the dashboard, not in `routes`.

- **Two entrypoints.** Workers Cache (July 2026) is the cache. It sits in front of an entrypoint and reads the `Cache-Control` of its responses. A request cannot skip it with a cookie: only a method other than `GET` or `HEAD`, a WebSocket upgrade, or an `Authorization` header skips it. Draft mode is a cookie, so one cached entrypoint cannot serve drafts. The Worker has two. `default` has no cache. It runs the gate, serves the Studio, renders drafts, POSTs and every path that is not cached. It sends to `Render`, through `ctx.exports` and without `Authorization`, every path of a page route a cache may keep (`RouteFacts.cached`, less `uncached`: the `live` pages and the `api()` routes, which it renders itself) and every `prerendered()` read the crawl saw. So a page published after the deploy is cached from its first request, as on Vercel. The key of a page is its path (`cf.cacheKey`), as on Vercel, so `?utm_source=` renders nothing again; a read keeps its query, which holds its arguments. Nothing seeds the cache: the key holds the Worker's version, so every path renders once after each deploy. `Render` has the cache. It renders in `async` mode and answers `public, max-age=3600, stale-while-revalidate=86400` and a `Cache-Tag` header. `default` then changes `Cache-Control` to `public, max-age=0, must-revalidate` and removes `Cache-Tag`, so a browser asks again and gets the purge.
- **Markdown copies.** The gateway keys the copy of a page by its `.md` path, also when the request asked for it with `Accept: text/markdown`, and sends `Render` that path with `Accept: text/html`. Workers Cache compares a `Vary` value verbatim, so a key per format, not `Vary: Accept`, keeps one entry for each. `Render` removes `Accept` from `Vary` before Workers Cache sees the answer, because the key already holds the format and a `Vary` that Workers Cache reads in a way we did not expect could split or mix the entries. The copy renders with its page's reads, so it gets the same `Cache-Tag` values. `aeo/DESIGN.md`, "How the copy is served", has the details, and why a site must not turn on Cloudflare's "Markdown for Agents" as well.
- **What `Render` caches.** Only a 200 that the render did not mark itself. An answer with no `Cache-Control`, or a crawled read with a server function's default `no-store`, gets the cache's lifetime; a page keeps its own `no-store`. A redirect, an error, or a response with `Set-Cookie` gets `private, no-store`, which Workers Cache respects, unlike Vercel's ISR: a 404 at a slug that is not published yet is never cached here (RFC 9111 lets a cache keep a 404 with no header at all). A response that keeps `Set-Cookie` or its own `private` is not cached.
- **Tags.** `tagCache()` and `purgeCache()` of `@visio/router` reach the cache on the request event (`router/DESIGN.md`, The cache); `@visio/sanity` calls them, and so may a site for its own data. The Worker passes its cache with `handleRequest`. In `Render`, `tag()` collects the tags. Nothing imports `@vercel/functions` in the Worker's build, so its `ws` is not in the bundle, and during the crawl, which has no cache, a tag does nothing. In `async` mode every read has finished before `handleRequest` returns, so the tags are complete before the headers go out. Workers Cache keeps 1000 tags on one response. A page with more tags is not cached and the Worker logs a warning: if only some tags were kept, a purge of a tag left off would not reach the page. `purge()` calls `Render.purge()` over RPC, because a purge reaches only the entrypoint that stored the response. When Cloudflare refuses the purge, the call throws, so the publish hook gets a 500 and does not report a purge that did not happen.
- **The server build.** The SSR build resolves `workerd` and `worker` ahead of `node`, and bundles every package, as for Vercel. Its rolldown `platform` is `neutral`. With `node`, a CommonJS `require()` of a built-in became `createRequire(import.meta.url)` in a shared chunk. workerd leaves `import.meta.url` undefined, so the Worker stopped before its first request. With `neutral`, the `require()` throws only when it runs. Wrangler uploads the modules as they are (`no_bundle`, `find_additional_modules`). The flag is `nodejs_compat`, and `COMPATIBILITY_DATE` in `src/output.ts` is the date visio is tested with. With it, `process.env` holds the Worker's variables and secrets, which `src/env.ts` and `@visio/sanity` read. `bun run env:push production` writes them (`packages/env/DESIGN.md`).
- **Variables.** The build writes `VISIO_BYPASS_TOKEN` into `vars` and `previews.vars`, new every build, and sets `keep_vars` so that a deploy keeps the variables of the dashboard. The Worker compares the variable with the token of its build. When they differ, every request that reaches the Worker gets a 500 that says why, because otherwise draft mode would stop with no error. The server's variables (`SANITY_*`, `SITE_PASSWORD`) are Worker secrets. Workers Builds gives the build its own variables, so a variable that the crawl and the Worker both read is set in both places.
- **Previews.** Since 2026-09-22, Workers Builds runs `wrangler preview` for every branch that is not the production branch. A Preview is a copy of the Worker, under the same name, at its own URL. It does not inherit production's variables, secrets or bindings. Before, a preview build ran `wrangler versions upload`, which makes a Version URL: a version of the production Worker, with production's settings. A Worker that was connected before 2026-09-22 keeps Version URLs until someone selects "Switch to Worker Previews" in its build settings. Wrangler takes a Preview's variables from `previews` and stops without that block, so the build always writes it. `assets`, `compatibility_date` and `compatibility_flags` stay at the top level, where Wrangler reads them for a Preview too. So do `exports` and `cache`: Wrangler 4.149 sends both with a Preview. A Preview gets a secret from the Previews base configuration: `wrangler preview base-config secret put NAME` sets it once, and only Previews created after that get it. `wrangler preview secret put NAME --name <preview>` sets it on a Preview that exists. A server that throws as it loads, because `src/env.ts` requires a variable the Worker does not have, stops workerd before its first request. Cloudflare runs the top level of a Worker when Wrangler uploads it, so that deploy fails and the error is in the build log, in production and in a Preview alike. The Worker that served before keeps serving. A Workers Builds run has not shown this yet.
- **Indexing per branch.** A Preview URL on `workers.dev` sends `X-Robots-Tag: noindex`, but a Preview URL on a custom domain does not. Build variables are set per trigger, one for the production branch and one for the other branches. A site that sets `PUBLIC_SITE_INDEXABLE=true` on both would index every Preview on a custom domain. So `visio:config` (in `visio`) treats a build as indexable only on the production branch. Workers Builds names the branch in `WORKERS_CI_BRANCH`, but not which branch is production: only its Builds API has that, in the production trigger's `branch_includes`, which the build cannot read without a token. The production branch is `main`, or the value of `VISIO_PRODUCTION_BRANCH`. A preview build with `PUBLIC_SITE_INDEXABLE=true` gets no sitemap and `noindex` on every page, and the build warns. Outside Workers Builds, `WORKERS_CI_BRANCH` is not set, and nothing changes.
- **Workers Builds settings.** Root directory: the site's folder (`site` in this repo). Build command: `bun run build`. Deploy command: `npx wrangler deploy`, and preview command: `npx wrangler preview`, the defaults. Build variables: the ones the crawl reads (`PUBLIC_SITE_URL`, `PUBLIC_SITE_INDEXABLE`, `SANITY_*`, `SITE_PASSWORD` for the gate), and `VISIO_PRODUCTION_BRANCH` when production is not `main`. Workers Builds runs the Wrangler of the site's `package.json`, and `npx` gets the latest when the site lists none. Cloudflare's docs name 4.135.0 as the oldest Wrangler for Worker Previews, so the build stops on an older Wrangler in `node_modules` (`MIN_WRANGLER` in `src/output.ts`). `wrangler preview` came in 4.121.0, in private beta; 4.134.0 is the first open beta.
- **Files.** `assets/` is the client build without `_static` and `.vite`. Without the gate, Cloudflare serves a file before the Worker runs, and the `_headers` file that the build writes gives it the security headers, `strict-transport-security` (Cloudflare does not add it), and `immutable` under `build.assetsDir`. A file there with no hash in its name gets a rule that removes `immutable`. A `public/_headers` stops the build. `html_handling` is `none`, so `/studio/index.html` does not redirect to `/studio/`. The Worker sets the same headers on each response it gives.
- Run `bunx wrangler dev` in the site's folder after `bun run build` to run the output in workerd on your machine. It needs no account. Workers Cache and its purge work only on Cloudflare. A Preview is not tested yet: Cloudflare's docs do not say if Workers Cache keeps and purges responses in a Preview, or if `ctx.exports` reaches `Render` there.

## Bindings

```ts
// vite.config.ts
import { bindings, cloudflare } from "@visio/cloudflare";

visio({
  deploy: cloudflare({
    bindings: {
      FEEDS: bindings.worker({ worker: "feeds" }),
      EMAIL: bindings.sendEmail({ destinationAddress: "studio@example.com" }),
    },
  }),
});
```

```ts
// src/lib/content.ts
import { binding } from "@visio/cloudflare/server";

import { env } from "../env";

export const getFeed = query(
  prerendered(async () => {
    "use server";
    const feeds = binding("FEEDS");
    const response = feeds
      ? await feeds.fetch("https://feeds/instagram")
      : await fetch(`${env.FEEDS_URL}/instagram`);
    return response.json();
  }),
  "feed"
);
```

`bindings` is the `env` of `@cloudflare/config`, Cloudflare's typed Worker config: a record of names to bindings, each made by its `bindings` helper (`bindings.kv()`, `bindings.r2()`, `bindings.d1()`, `bindings.queue()`, `bindings.sendEmail()`, `bindings.worker()` and the rest), which `@visio/cloudflare` re-exports under its own name. The build turns the record into Wrangler's keys (`kv_namespaces`, `send_email`, `services`) with that package's own converter, so every binding type Cloudflare has works with no code in visio, and Cloudflare's docs apply with the keys in camelCase. An entry that is `false`, `null` or `undefined` is left out, as in Cloudflare's config. `binding(name)` from `@visio/cloudflare/server` gives a binding to server code. It returns undefined where the Worker has no such binding: in `vite dev`, in the crawl, which runs the server in Node, and in a Preview (below). There a site falls back: for another Worker, its URL, which works from outside Cloudflare (`src/env.ts` declares `FEEDS_URL`); for a mail notice, nothing. A name that is not in `bindings`, or that names a variable or a secret, is undefined too. On Cloudflare `binding()` then warns once per name, because a fallback fetch to another Worker would get error 1042 with no error that names the cause. A Preview warns too.

- **Another Worker.** A Worker cannot fetch another Worker of the same account through its URL: Cloudflare answers error 1042 (Cloudflare's "Errors and exceptions": "Worker tried to fetch from another Worker on the same zone"). `bindings.worker({ worker: "feeds" })` reaches it; `exportName` names a `WorkerEntrypoint` other than the default export. A Worker, a Durable Object's or a Workflow's, is bound by its name, never its config: the schema the build parses with takes a string, and a site's config does not hold another Worker's.
- **What visio owns.** A variable or a secret (`bindings.text()`, `bindings.json()`, `bindings.secret()`) goes in `src/env.ts`, and the build binds the assets itself as `ASSETS`. The type leaves these out, and a site that casts one in gets a build error that says where it goes. So does a name that is not a JavaScript name, or one the Worker reads itself: `ASSETS`, `SITE_PASSWORD`, `VISIO_BYPASS_TOKEN`. These checks and Cloudflare's own schema run when `cloudflare()` is called, before the build and the crawl, so a second `bindings.ai()` stops the build at once, with the binding's name.
- **Production only.** The build writes the bindings at the top level and none into `previews`, and Wrangler gives a Preview only the bindings of `previews` (Wrangler 4.157's source). So a Preview sends no mail to a client and writes nothing into production's data, and a Preview's service binding, which would call the bound Worker's production deployment (Cloudflare's "Previews" docs), does not count a Preview's requests with production's. `wrangler preview` warns that the bindings are configured for production but not for Previews; the warning does not stop it. Bindings for a Preview are not built: no site needs them yet. A Workers Builds run of a Preview with a binding has not been tested yet.

- **How it reaches the env.** Cloudflare gives the env to an entrypoint, not to a module. The env is the same for every request of an isolate, so `default` and `Render` each put theirs in one `globalThis` slot (`ENV_KEY`, `Symbol.for("@visio/cloudflare/env")`) before they render, and `binding()` reads it. `Render` runs in the same isolate through `ctx.exports`, with the same bindings.
- **Not `cloudflare:workers`.** `import { env } from "cloudflare:workers"` works in workerd, but the crawl imports the built server in Node, which cannot load a `cloudflare:` module (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), and neither can `vite dev`. One such import in server code stops the build.
- **The type.** `binding()` returns a `Fetcher`, a `fetch` like Cloudflare's. Any other binding, or an RPC method of a `WorkerEntrypoint`, the caller names: `binding<SendEmail>("EMAIL")` with the type from Cloudflare's Workers types, or a local interface of the methods it calls, `binding<FeedsService>("FEEDS")`. `src/env.ts` cannot hold a binding, because a binding is an object, not a string.
- **Not `global_fetch_strictly_public`.** That compatibility flag also lifts error 1042, because the global `fetch` then goes out as a request from the Internet. visio does not offer it: the call leaves Cloudflare and comes back through the other Worker's public URL, so that Worker must be public, and the flag changes every `fetch` of the Worker, also one to the site's own domain, which then reaches the site's Worker again instead of skipping it.
- **Tested** in workerd: the lab built for Cloudflare with a service binding `FEEDS`, a `prerendered()` read that calls `binding("FEEDS")`, and `wrangler dev` with a second Worker's config. The crawl got undefined and the build passed; `/router/late`, which `Render` renders, showed the other Worker's answer. A deploy to Cloudflare has not been tested yet.
- **Tested** in workerd: the lab built for Cloudflare with `EMAIL: bindings.sendEmail({ destinationAddress })` and `CACHE: bindings.kv({ id })`, and `wrangler dev` 4.157: Wrangler listed both, and an `api()` route that calls `binding("EMAIL").send()` got a message id from the local email simulation. A real send and a deploy have not been tested yet.

## Logs

The config turns on Workers Logs (`observability: { enabled: true }`), so the Worker's warnings and errors, and an uncaught exception, are in the dashboard. Workers Logs then also keeps one invocation log per request: the request with all its headers (`cf-connecting-ip`, `x-real-ip`, the user agent) and its `cf` object (city, postcode, coordinates, network, TLS fingerprints). It keeps them 3 days on Workers Free and 7 on Paid. A site whose privacy policy says it stores no IPs cannot keep these, and with them a cookieless stats row (path and time) can be matched to an IP.

```ts
visio({
  deploy: cloudflare({ observability: { logs: { invocationLogs: false } } }),
});
```

`observability` is the type of `@cloudflare/config`, Cloudflare's typed Worker config: Wrangler's keys in camelCase (`invocationLogs` for `invocation_logs`). The build writes it in snake_case over `{ enabled: true }`, so Cloudflare's docs apply with the keys in camelCase. `@cloudflare/config` is pinned, because Cloudflare says its API can still change; a bump that changes the type fails the typecheck. `logs.invocationLogs: false` drops the invocation logs and keeps `console.log` and `console.error`. A Preview has no `observability` in `previews`, so Wrangler gives it the top-level one (Wrangler 4.151's source). Not verified: if an uncaught exception still shows in Workers Logs with `invocationLogs: false`. Cloudflare's docs ("Workers Logs") name invocation logs, custom logs, errors and uncaught exceptions as separate types, and say only that the flag turns off the first. A request that throws may then be visible only through its invocation log. Until a deploy shows it, a site that turns them off catches what it must see and logs it with `console.error`.

## Password gate

With `SITE_PASSWORD` set at build time, the Worker holds `@visio/gate` with its types stripped. On Cloudflare the Worker runs first for every request (`run_worker_first`). It asks for the password before it serves a file or renders a page, and reads `SITE_PASSWORD` from its secrets: set it as a Worker secret too, or every request gets a 500. The dev server is never gated. `gate/DESIGN.md` has the cookie and the form.

## Observe

```ts
visio({
  deploy: cloudflare({
    observe: "src/observe.ts",
    bindings: { ANALYTICS: bindings.worker({ worker: "analytics" }) },
  }),
});
```

```ts
// src/observe.ts
import type { ObserveArgs } from "@visio/cloudflare";

export default function observe({
  request,
  kind,
  path,
  status,
  env,
  ctx,
}: ObserveArgs<Env>) {
  if (!env.ANALYTICS || !isCrawler(request)) return;
  ctx.waitUntil(env.ANALYTICS.crawl({ path, kind, status }));
}
```

The hook is for what only the Worker sees: requests of AI crawlers and agents, which run no JavaScript, so a script in the page never counts them. `default` calls it once per request, after the answer exists, with the security headers set, and returns that answer as it is. It runs for every request, so a hook that returns early costs a function call. A report goes in `ctx.waitUntil`, or the hook returns a promise, which the Worker passes to `ctx.waitUntil` itself. A hook that throws or rejects is logged, and the answer does not change. The hook never touches the cache: `Render` and its `Cache-Control`, key and `Cache-Tag` run before it, and a page that Workers Cache answers still reaches the hook, because the cache sits in front of `Render`, not `default`.

`kind` is what the request asked for, and `status` whether it got it: `page`, `markdown` (a `.md` copy, or a page asked for with `Accept: text/markdown`), `robots`, `llms`, `sitemap`, or `other` (a file, a POST, a server function, an `api()` route, the Studio). For a page and its copy, `path` is the page's path (`/` for `/index.md`), else the request's path. visio knows these better than the site, because it owns the Markdown paths and the aeo files. A 404 at a page path is a `page` with status 404. `RouteFacts.api` of `@visio/router` names the `api()` routes, so the Worker does not call one a page.

- **Bundled on its own.** `observe` is a path from the site's root. The build bundles it with Vite into `worker/observe/index.js`, with the server's conditions (`workerd` first) and none of the site's plugins, so it shares no module with the server. It runs beside the server and imports none of it. `node:*` and `cloudflare:*` stay imports. With no site plugins, no `define` and no `.env`, a module that reads `import.meta.env` gets `undefined` there, so the hook imports plain TypeScript and packages only. A path that is not a file stops the build before it starts. The bundle and the import in `worker/index.js` exist only with a hook: without one, `index.js` and `wrangler.json` are what they were before the hook existed.
- **Live lists.** With the build's lists (`visio/DESIGN.md`, Live lists), `/sitemap.xml` and `/llms.txt` leave the assets, since a file would win, and count as reads: the Worker sends them to `Render`, which Workers Cache keeps under the tags of the reads of `announce()`. The Worker's entry sets the lists as a global before the server runs.
- **The aeo files.** Without the gate, Cloudflare serves a file before the Worker runs, so `robots.txt`, `llms.txt` and the sitemap would never reach the hook. With a hook, `run_worker_first` is the list `OBSERVED_FILES` (`/robots.txt`, `/llms.txt`, `/sitemap*.xml`; Cloudflare's docs, "Static Assets", "run_worker_first": an array of globs, `*` crosses `/`, at most 100), and the Worker serves those paths from `ASSETS` itself, as it does behind the gate. Every other file is still served before the Worker. Behind the gate, `run_worker_first` stays `true`.
- **The binding.** The hook reaches the other Worker through a binding of `bindings` (Bindings). A Preview has none, so its crawler requests are not counted with production's: in a Preview `env.ANALYTICS` is undefined, and the hook checks for it.
- **Tested** in workerd: `wrangler dev` with the site's config and a second Worker's config, a `crawl()` RPC method on its `WorkerEntrypoint`. A request with `User-Agent: GPTBot` to a page, its `.md` copy, `Accept: text/markdown`, robots.txt, llms.txt, the sitemap and a 404 each reached it once; a browser's none. A deploy to Cloudflare has not been tested yet.
- **Vercel** has no hook: it has no bindings, and its edge cache answers a cached page before any function runs, so a hook there would see only the misses.
