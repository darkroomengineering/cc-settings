# Preview

On either deploy target, once per project:

1. `.env` of the site: `SANITY_READ_TOKEN`, a Viewer token from the project's API settings, and `SANITY_REVALIDATE_SECRET` (`openssl rand -base64 32`). The same on Vercel, or on Cloudflare as Worker secrets and as Workers Builds variables: the crawl reads the token, and the build warns without the revalidate secret. A Cloudflare Preview has none of production's secrets: set each once with `wrangler preview base-config secret put NAME`.
2. Open Presentation in the Studio. It calls `/api/sanity/enable`, which sets the draft cookies and shows the page with drafts; reads through `fetchQuery` switch on their own, and every cached page and read is skipped for the editor.
3. Publishing: add a GROQ webhook in the project's API settings (sanity.io/manage, the project, API, Webhooks), once:
   - URL: `https://<site>/api/sanity/revalidate`, the deployed site's origin (the Worker's own on Cloudflare) and the `studio.api` path. Change it when the site moves to another host or domain.
   - Dataset: the site's `SANITY_DATASET`.
   - Trigger on: Create, Update and Delete. Filter and projection: empty.
   - Drafts: off. Versions: off.
   - HTTP method: POST.
   - Secret: the site's `SANITY_REVALIDATE_SECRET`.

   A publish then purges every cached page and read, and each renders again on its next request. A build on Vercel or Workers Builds with the Studio on warns when `SANITY_REVALIDATE_SECRET` is not set.

Nothing else is per site. `sanity()` serves the routes, `defineStudio()` points Presentation at them, and `<VisualEditing exit={...} overlay={...} />` is in `app.tsx`. With the Studio on, a build in which nothing renders `<VisualEditing />` stops and says so.

The Studio is on the site's origin, so an editor who opens the site after Presentation sees it in draft mode, the whole site with drafts. The site renders two controls for that editor, as its own buttons in its own style: `exit` leaves draft mode (call `end` on click), and `overlay` turns the edit overlay on and off (call `toggle`; `shown()` says which). Outside Presentation the overlay starts off; on, a click on an element opens it in the Studio. `VisualEditing` renders both only in a draft session outside Presentation, never in its iframe or preview window, and never to a visitor. Never make it a link: there is no URL to link to, and a prefetched link to the disable route would end draft mode at once. The cookies last 8 hours.

```tsx
<div class={s.draft}>
  <VisualEditing
    exit={(end) => <Button onClick={end}>Exit draft mode</Button>}
    overlay={(shown, toggle) => (
      <Button onClick={toggle}>
        {shown() ? "Hide edit overlay" : "Show edit overlay"}
      </Button>
    )}
  />
</div>
```

Place the box fixed in a corner, above the page (`position: 'fixed'`), where it covers no navigation.

With a custom `studio.api`, the webhook's URL takes that path.
