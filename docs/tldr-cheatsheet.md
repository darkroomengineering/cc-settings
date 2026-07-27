# TLDR Cheatsheet

Token-efficient codebase analysis behind the `tldr` MCP server. Prefer it over
raw reads on large codebases; use Read/Grep when you need exact content or the
file is small.

The tool names are the stable contract — only the engine behind them changes.
Select with `CC_CODE_INTEL_ENGINE`, but note that the `tldr` entry in
`~/.claude.json` is written at install time: switching engines means re-running
`setup.sh` with the variable set, not just exporting it. Full contract:
`skills/tldr/SKILL.md`.

## Default: `native-ts`

Zero-dependency TypeScript-compiler codemap. Nothing to install, no daemon, no
index to warm — normal use is through the `mcp__tldr__*` tools. (A local CLI
exists at `src/codemap/cli.ts` for manual debugging; it is not something users
install.) **TS/JS only.**

| Instead of... | Use |
|---|---|
| Locating a symbol in a large file | `context` (signature, callers, callees) |
| A file's symbol inventory | `extract` — names, kinds, lines, signatures; **not** source bodies, so `Read` is still what you use for exact code |
| Finding callers | `impact` |
| Forward import graph | `imports` |
| Reverse import lookup | `importers` |
| Call edges across the project | `calls` |
| Architecture overview | `arch` |
| Symbol inventory per file | `structure` |
| File tree | `tree` |
| What the working tree changed | `change_impact` |
| Engine health | `status` |

`extract`, `imports`, `importers`, `context`, and `impact` require a
symbol/target argument. Pass it — since v12.10.0 a missing one returns a
`missing-required-argument` error naming the accepted keys, rather than an empty
result that reads like a true negative.

Everything else — `semantic`, `dead`, `diagnostics`, `slice`, `cfg`, `dfg`,
`search` — returns `unsupported-by-native-engine`. That means **the analysis did
not run.** Fall back to `Grep`; never report it as an empty finding.

## Opt-in: `CC_CODE_INTEL_ENGINE=llm-tldr`

Adds multi-language support plus `semantic`, `dead`, `diagnostics`, `slice`,
`cfg`, `dfg`, `search`. Worth it on Rust/Python/Go repos. Select it with
`CC_CODE_INTEL_ENGINE=llm-tldr bash setup.sh` and restart Claude Code — a
shell-only export leaves the MCP server on the previously installed engine.
Requires `pipx install llm-tldr` (v1.5+); cc-settings starts its daemon on `SessionStart`
and notifies it on every Write/Edit, so queries hit a hot in-memory index
(~100 ms) instead of cold-spawning the CLI (~30 s). Check with
`tldr daemon status`.

Two caveats, both measured 2026-07-27 and neither fixable upstream
(`parcadei/llm-tldr` was archived 2026-07-13):

1. **`language` does NOT auto-detect — it defaults to `python`.** On a TS repo,
   omitting it returns `{"status":"ok"}` with an EMPTY result rather than an
   error. Always pass it explicitly (`typescript`, `go`, `rust`, … or `all`).
   The `impact` and `semantic` tools expose no `language` parameter at all —
   cross-check those with `Grep`.
2. Archived upstream, so treat its behaviour as frozen.
