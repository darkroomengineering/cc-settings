---
name: session
description: How signed cookie sessions work with @visio/session - reading in queries, writing in actions, secrets and rotation, expiry, and the live server they need. Read before adding sign-in, per-visitor state, or anything that reads or writes the session cookie.
---

# @visio/session

```ts
// src/server/session.ts
export const session = createSession<{ userId?: string }>({
  secrets: env.SESSION_SECRET,
});

// src/lib/account.ts
export const getCurrentUser = query(async () => {
  "use server";
  const userId = (await session.get())?.userId;
  return userId ? findUser(userId) : null;
}, "current-user");

export const login = formAction(async (formData: FormData) => {
  "use server";
  await session.set({ userId: String(formData.get("id")) });
});
```

`createSession` from `@visio/session` is a signed cookie over the request event. `session.get()` reads the session: what this request already wrote, else what arrived with it (null when absent, tampered, signed by a dropped secret, or expired). `session.set(data)`, `session.update(patch)`, and `session.clear()` write to the outgoing response, so they work inside server functions and middleware, and a `throw redirect()` after a `set()` still carries the cookie. The SSR render can only read: once the response head is sent, a write throws in dev and does nothing in production. A `query()` reads the session and `formAction()`s write it; the router refetches the query when they settle, and `<form action={login} method="post">` works before hydration.

- The options are `secrets`, `name` (default `session`) and `maxAge`. The cookie attributes are fixed: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`, so only the host that set the cookie gets it. Browsers treat localhost as secure, so the dev server over http keeps the cookie. A phone on `http://192.168.x.x` gets no session, because the cookie is always `Secure`: test sessions on localhost or over https.
- Signed, not encrypted: the payload is client-readable. Keep secrets out of it and keep it small; a cookie caps at about 4 kB. Expiry is enforced on the server after `maxAge` (default a week) whatever the client sends.
- `SESSION_SECRET` is comma-separated, newest first: the first signs, every one verifies. Rotate with `"new,old"` and drop `old` after `maxAge`. Every secret in the list needs at least 32 characters (`openssl rand -base64 32`); `createSession` throws when one is shorter, but only once a request loads the session module. Check the length in `src/env.ts` too, as `lab/src/env.ts` does, so the dev server names the variable in its terminal when it starts. It is optional in `src/env.ts`, so a site that never reads its session boots without one; the first session call names it when it is missing.
- **Sessions need a live server.** A page that reads one is a `live` route (the router skill), so its response is never cached.
- Server-side checks are the real gate: an action that changes data reads `session.get()` first; the UI hiding a form is cosmetic.
