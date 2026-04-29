---
name: init
description: Initialize new project with Darkroom standards (Next.js, React, satus template). Triggers "new project", "start project", "initialize", "setup project", "satus".
argument-hint: "[project-name]"
---

# Initialize Darkroom Project

Create a new project using the Satus starter template.

## Satus Starter

**Always use Satus** for new projects:

```bash
bunx degit darkroomengineering/satus $ARGUMENTS
cd $ARGUMENTS
bun install
```

## What Satus Includes

- **Next.js 16+** with App Router
- **React 19+** with React Compiler
- **TypeScript** strict mode
- **Tailwind CSS v4**
- **Biome** for linting/formatting
- **Lenis** smooth scroll setup
- **Hamo** performance hooks
- **Image/Link wrappers** configured
- **CSS Modules** with `s` alias pattern

## Post-Setup

After cloning:

1. **Update package.json** - Change name, description
2. **Configure environment** - Copy `.env.example` to `.env.local`
3. **Start dev server** - `bun dev`
4. **Open debug mode** - `Cmd/Ctrl + O` in browser

## Project Structure

```
app/                 # Next.js pages and routes
components/          # React components
lib/
├── hooks/          # Custom React hooks
├── integrations/   # Third-party clients
├── styles/         # Global CSS, Tailwind
└── utils/          # Pure utility functions
```

## Don't Use

- `create-next-app` - Missing Darkroom standards
- `create-react-app` - Deprecated
- Manual setup - Too many things to configure

## Output

After initialization:
- Confirm project created
- List next steps
- Offer to start dev server
