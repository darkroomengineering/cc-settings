# cc-settings landing page

Run `bun run serve` and open http://cc-settings.localhost:4318/. The home, privacy,
support and 404 pages use static HTML and CSS with a small clipboard script, following the
[Nulla](https://github.com/darkroomengineering/nulla).

`bun run build` writes the Vercel Build Output artifact to `.vercel/output`.
The routing table serves Markdown at the same URL when requested through the
`Accept` header, and unknown paths return the static 404 page with status 404.

When editing a page, update its Markdown companion so both representations
describe the same product and legal terms. The deploy command targets the
existing `cc-settings-site` project. Verify the preview before releasing.
