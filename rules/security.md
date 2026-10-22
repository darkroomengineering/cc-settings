---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "app/api/**/*"
  - "lib/**/*"
  - ".env*"
---

# Security

> `AGENTS.md` owns the secrets, injection, and trust-boundary rules. This file holds the stack details.

- **Client exposure:** only `NEXT_PUBLIC_*` (Next.js) or `VITE_*` (React Router / Vite) variables reach the browser. Never export a config object that reads a secret into client code.
- **Never commit:** `.env`, `.env.local`, `.env.production`, `credentials.json`, `*.pem`, `*.key`. Secrets live in `.env.local` for dev (gitignored) and platform secrets for prod.
- **Fail fast on missing config:** `if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')`.
- **Trust boundaries:** parse API-route, webhook, and form-handler input with zod (`Schema.parse(input)`); use parameterized queries or the ORM; validate `redirect()` targets against an allowlist; never pass user content to `dangerouslySetInnerHTML`.
