---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

> `AGENTS.md` owns strict mode, no `any`, interface-over-type, and discriminated unions. This file holds the rest.

- `tsconfig`: `"strict": true` plus `"noUncheckedIndexedAccess": true`.
- Validate `unknown` at trust boundaries with a schema (`UserSchema.parse(data)`), not `data as User`.
- Keep generics as simple as the call sites need: `function get<T>(obj: T, key: keyof T)`, not `<T, K extends keyof T, V extends T[K]>`.

## Tools

- **deslop** *(optional — when `deslop-cli` is in the project's deps)* — framework-agnostic cross-file dead-code / unused-export / circular-import scanner that catches what Biome's per-file linting can't. Run pinned: `npx deslop` (`--json` for a machine-readable report, `--fail-on-issues` to gate CI). `bun run proof` auto-includes it as an advisory signal when present.
