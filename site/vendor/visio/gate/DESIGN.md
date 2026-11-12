# @visio/gate design

One password in front of a whole deployment on Vercel or Cloudflare, for a client site before launch or a preview the client reviews. Ported from novus's password protection, rebuilt for where a visio site is served from.

## Why it is Routing Middleware

Most of a visio deployment never reaches the site's server: Vercel serves crawled pages from its cache and files from `static/`, and `src/middleware.ts` only runs in the one live function. A gate there would leave every cached page open. Vercel's Routing Middleware runs before all of it, so the gate is an edge function the build writes into `.vercel/output` (`functions/_middleware.func`), with a route ahead of `handle: filesystem` that sends every request through it.

novus split the job in two: its edge part only checked that the cookie existed, and React Router checked the signature. Here the edge function is the only gate, so it does both, with `crypto.subtle`.

## On and off

`SITE_PASSWORD` set at build time turns it on, and there is no option in `visio()`. Vercel builds each environment with its own variables, so scoping the variable to Preview gates previews and leaves production open. Changing it needs a redeploy, as any variable does. The edge function reads the password at runtime (`envVarsInUse`), so it is never written into the output. Without it at build time, nothing is emitted and an open site pays nothing per request.

On Cloudflare the gate runs in the Worker, which then runs first for every request, files included (`packages/cloudflare/DESIGN.md`). The Worker reads the password from its secrets, so it is set there too.

Every build writes a deploy output, so every build can hold the gate. Until 2026-10-10 a build without `prerender` was a plain server, and it stopped when `SITE_PASSWORD` was set rather than go out open. The dev server is never gated.

## The cookie

`__visio_gate`, for a week: an expiry and an HMAC of it keyed by the password itself, so there is no second secret to set. Forging one takes the password, and a new password ends every visitor's access. `HttpOnly`, `SameSite=Lax`, `Secure` on https.

## The form

Plain HTML with nothing from the app, answered with a 401 at whatever address was asked for, `private, no-store`, `noindex` and `X-Frame-Options: DENY`. It posts back to the same address; the right password answers a 303 to it with the cookie, a wrong one the form again with an error. The password is compared through an HMAC of each side, so the time taken says nothing about it.

## Open paths

A request that carries its own secret and cannot type a password goes through: with the Studio on, that is Sanity's publish hook at `/api/sanity/revalidate` (`<studio.api>/revalidate` with a path of the site's own). Everything else is gated, the Studio and draft mode included; an editor enters the password once.

## The code

`src/gate.ts` holds all of the gate in one file that imports nothing, because the build copies it into the edge function with its types stripped. The package entry, `src/index.ts`, exports only `PASSWORD_VAR`; the deploy packages copy `src/gate.ts` itself. The tests import the rest from `src/gate.ts`. A site never calls the gate itself: `SITE_PASSWORD` is the only switch.

## Not here

- Rate limiting. Vercel's firewall rules are the place for it.
- Users or roles. One shared password is the whole feature; per-visitor access is `@visio/session`.
- Vercel's own Password Protection, which is a paid add-on, and Vercel Authentication, which needs a Vercel account a client does not have.
