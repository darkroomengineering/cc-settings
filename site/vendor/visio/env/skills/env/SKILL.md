---
name: env
description: How a visio site's environment works with @visio/env - one defineEnv() in src/env.ts with server, client and local blocks, reading it with `import { env } from "../env"`, the dotenvx-encrypted .env files in git and their key, `bun run env:push` to Vercel or Cloudflare, and the build's guard. Read before you add, rename or read an environment variable, or when a build stops with an [@visio/env] code.
---

# @visio/env

The values live in dotenvx-encrypted files in git, one per mode. The key stays out of git. Code reads the values typed, from one file. A developer pushes them to the platform; the platform's build checks that the push is current.

## Declare

`src/env.ts` holds one call, and nothing else:

```ts
import { defineEnv } from "@visio/env";
import * as v from "valibot";

export const env = defineEnv({
  server: { SANITY_READ_TOKEN: v.optional(v.string()) },
  client: { PUBLIC_SITE_URL: v.optional(v.pipe(v.string(), v.url())) },
  local: { VERCEL_TOKEN: v.string() },
});
```

- `server`: secrets and anything only the server reads. They never reach the browser.
- `client`: public values, names with `PUBLIC_`. The build puts them in the bundle as constants.
- `local`: values for tools on a developer's machine, such as the push's tokens and ids. They are not on `env`, and the push never sends them; it validates them before it sends anything. They may be plain: an id is not a secret.
- A client value is a string, a number or a boolean (`CLIENT_VALUE_NOT_PLAIN`): make the `URL` where you use it.
- `VISIO_PRODUCTION_BRANCH`, when production is not `main`, goes in `server`, so the push sends it to the build.
- Any Standard Schema validator works (valibot in this repo). Keep it synchronous.

## Read

```ts
import { env } from "../env";
```

The path is relative, as for any module (this one is from `src/pages/`); TypeScript names a wrong one. Read a server value only in server code: a `'use server'` function, `src/server/`, middleware, an `api()` route. A module the browser loads that reads a server or local var stops with `SERVER_VAR_IN_CLIENT`. A read inside `if (isServer)` stops too: move it into a `'use server'` function. Never import `virtual:solid-env/*`, `dotenv` or `@dotenvx/*`, and never read `import.meta.env.PUBLIC_*`: lint bans them, and Solid's env plugin is off.

## The files

- `.env` is dev, `.env.preview` and `.env.production` are what the push sends. A build reads the file of its mode (`.env.production` for `bun run build`). Nothing layers: `.env` never reaches a build.
- Edit them with the dotenvx CLI: `dotenvx set NAME value -f .env.production`, `--plain` for a `PUBLIC_` value. `dotenvx get NAME -f .env` prints one.
- `.env.keys` holds the private keys. It stays out of git; share it the way the team shares secrets. `DOTENV_PRIVATE_KEY_PRODUCTION` in the shell works too, and either may list several keys with commas during a rotation.
- The shell wins over the file. Without the key, an encrypted value stays unset and the dev server prints `KEY_MISSING`.
- A file in git fails the build on a plain server value (`SECRET_PLAIN`), a name `src/env.ts` does not declare (`VAR_UNDECLARED`), and `.env.keys` in git (`KEYS_COMMITTED`). A file git does not track is not checked.

## Push

`bun run env:push production` (or `preview`) decrypts the file and writes its server and client values to the deploy target of `vite.config.ts`. Run it after every change to the file, then deploy.

- Vercel: needs `VERCEL_TOKEN`, and the project from `vercel link` or `VERCEL_PROJECT_ID` (with `VERCEL_ORG_ID` for a team). Values apply from the next deployment.
- Cloudflare: needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_WORKER_NAME`. It sets the Worker's secrets, which go live at once, and the build variables of the production branch. Previews are not pushed yet: set them with `wrangler preview base-config secret put NAME`.
- Put those tokens in the `local` block, and in `.env`.

## The guard

On Vercel and in Workers Builds, the build reads no file: the platform has the values. It compares `VISIO_ENV_HASH`, which the push set, with the committed file, for each target the platform can push to (not Cloudflare previews yet). A mismatch stops with `ENV_NOT_PUSHED`: run the push and deploy again. A missing or invalid value stops any build with `ENV_INVALID`, on the platform or off it: the crawl starts the server, which needs them. A variable CI cannot have is optional in `src/env.ts`.
