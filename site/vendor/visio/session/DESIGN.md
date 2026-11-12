# @visio/session: design

Signed cookie sessions for Solid 2 server code. The skill (`skills/session/SKILL.md`) has the API and the rules for a site; this file has why it is built this way.

## The design

- **HMAC-SHA256 over a JSON payload.** The cookie holds `{ data, exp }` and its signature. Signed, not encrypted: the client can read the payload, so a site keeps secrets out of it.
- **Expiry is checked on the server.** The cookie's `Max-Age` tells the browser when to drop it, but a client can keep sending an expired cookie, so `get()` checks `exp` too.
- **Read from the request event, written to its response stub.** A write in a server function or a middleware lands on the response even when a `throw redirect()` follows it. What the request wrote so far is kept on the event, so a `get()` after a `set()` in the same request sees the new data. It is the object given to `set()`, not a copy: a change to it shows in the next `get()` but reaches the cookie only with the next write. Two `update()` calls at once in one request do not merge: the last write wins.
- **Secrets, newest first.** The first signs and every one verifies, so a rotation is `"new,old"` and `old` goes after `maxAge`. A string is split on commas, which is how an environment variable carries the list. `undefined` defers the error to the first use, so a site that never touches its session boots without one. The keys are imported on the first use for the same reason.
- **Fixed cookie attributes.** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`. Browsers treat localhost as secure, so the dev server over http keeps the cookie.
