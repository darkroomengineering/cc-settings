---
name: dr-init
description: Initialize a new Darkroom project from the satus or novus starter. Triggers "new darkroom project", "satus", "novus", "scaffold from starter". Not the native /init, which writes CLAUDE.md.
argument-hint: "[project-name]"
---

# Initialize Darkroom Project

Create a new project using a Darkroom starter. Darkroom maintains two:

| Starter | Stack | When to use |
|---|---|---|
| **satus** | Next.js 16 + App Router + RSC + React 19 + React Compiler, TypeScript strict, Tailwind v4, Biome, Lenis, Hamo, Image/Link wrappers, CSS Modules with `s` alias, `@/` alias | Content-driven sites, SEO-critical, Vercel-friendly, projects that benefit from Server Components / Server Actions |
| **novus** | React Router 7 + SSR via Vite + React 19 + React Compiler, TypeScript strict, Tailwind v4, Biome, t3-env + Valibot, CSS Modules with `s` alias, `~/` alias; optional WebGL (R3F), Anime.js, Theatre.js, Sanity CMS | SPA-leaning apps, projects that prefer the loader/action data model, projects without need for RSC, projects deploying to non-Vercel infra |

## Step 1 — Pick the starter

If the user already specified ("/dr-init satus", "/dr-init novus", "create new react-router project"), use that. Otherwise ask:

```
Which starter?
- satus (Next.js)   — App Router, Server Components, Vercel-optimized
- novus (React Router) — RR7, Vite, classic loader/action model
```

When the user is unsure, prefer **satus** for marketing/content sites and **novus** for app-heavy SPAs.

## Step 2 — Clone

```bash
bunx degit darkroomengineering/<satus|novus> $ARGUMENTS
cd $ARGUMENTS
bun install
```

## Step 3 — Post-setup

Both starters:
1. **Update package.json** — change `name`, `description`.
2. **Configure environment** — copy `.env.example` to `.env` (or `.env.local` for satus).
3. **Start dev** — `bun dev`.
4. **Open debug** — `Cmd/Ctrl + O` (satus) or `Cmd + .` / `Ctrl + O` (novus).

## Project structure

### satus
```
app/                 # Next.js routes
components/          # React components
lib/
├── hooks/          # Custom hooks
├── integrations/   # Third-party clients
├── styles/         # Global CSS, Tailwind
└── utils/          # Pure utilities
```

### novus
```
app/
├── root.tsx        # Root layout
├── routes/         # Route modules (file-based)
└── routes.ts       # Optional explicit route config
components/         # React components
hooks/              # Custom hooks
integrations/       # Third-party clients
styles/             # Global CSS, Tailwind
utils/              # Pure utilities
```

## Don't use

- `create-next-app` / `create-react-app` — missing Darkroom standards
- Manual setup — too many things to configure

## Output

After initialization:
- Confirm project created and which starter was used
- List the next steps (env, dev server)
- Offer to start the dev server
