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

## Implicit state machines

Most UI and async code is a state machine; the bugs come from leaving it implicit. Watch for these while writing or editing, not only when asked:

- two or more booleans describing one lifecycle (`isLoading`, `isError`, `isSuccess`, `isOpen` with `isClosing`)
- a `status` string next to fields that are only valid in some statuses (`data` and `error` both optional)
- `setState` calls that must always happen together, or effects that react to each other's flags
- refs or flags that guard against running twice (`isSubmittingRef`), and timers that move something from one phase to the next

Model it as one discriminated union that carries each state's data, and put the transitions in one function or reducer, so impossible combinations cannot be written:

```ts
type Upload =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "done"; url: string }
  | { status: "failed"; error: string };
```

- Convert before adding a second flag to the same lifecycle; do not add the flag and convert later.
- In code you are not otherwise changing, name the machine and its impossible states once to the user instead of refactoring it (AGENTS.md "Bug Fix Scope").
- A plain union and a reducer are the default. Reach for a state machine library only when the project already uses one, or when guards, parallel states and many transitions make the reducer harder to read than the chart.

## Tools

- **deslop** *(optional — when `deslop-cli` is in the project's deps)* — framework-agnostic cross-file dead-code / unused-export / circular-import scanner that catches what Biome's per-file linting can't. Run pinned: `npx deslop` (`--json` for a machine-readable report, `--fail-on-issues` to gate CI). `bun run proof` auto-includes it as an advisory signal when present.
