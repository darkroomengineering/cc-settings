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

## Opt-in CLI: `tldr-code` (pinned, `CC_PINNED_TOOLS=tldr-code`)

`tldr-code` (`github.com/parcadei/tldr-code` v0.4.0) is a Rust rewrite of the
archived `llm-tldr`, shared by its maintainer once the old project went stale.
Its **CLI only** — never its bundled MCP server — is wired into cc-settings.

**Why CLI-only.** The CLI was measured accurate: `tldr dead . --lang
typescript` against this repo returns `dead_functions: []`,
`functions_analyzed: 648`, matching ground truth. Its bundled `tldr-mcp`
server was measured NOT accurate — pointed at the same repo it reported live,
actively-called symbols (`getCalls`, `getContext` in
`src/codemap/callgraph.ts`) as hard `dead_functions` with `line: 0`, and it
returns `status: ok` + `total_functions: 0` on a wrong `language` value, the
exact silent-wrong-answer shape v12.9.0 moved the default engine away from.
`tldr-mcp` is therefore never installed and never registered in
`src/lib/code-intel-engine.ts`'s `ENGINES` registry — `native-ts` stays the
MCP engine regardless of whether this CLI is present.

**What it adds over `native-ts`:** `dead`, `search`, `taint`, `vuln`,
`smells`, `complexity`, `health`, `hotspots`, `churn`.

**Install (opt-in, not part of a plain `setup.sh` run):**
```bash
CC_PINNED_TOOLS=tldr-code bash setup.sh
```
Installs to `~/.claude/code-intel/tldr-code/0.4.0/tldr`, checksum-verified
per platform before extraction (`src/lib/pinned-tools.ts`). A failed install
warns and does not abort the rest of setup. Consumers detect availability
with `tldrCodePath()` from that module, or by checking the path directly.

**Three measured caveats — read before scripting against it:**

1. **It exits 0 even on errors.** `Error: Path not found` and `unrecognized
   subcommand` both exit 0. Never trust the exit code — check that stdout
   parses as JSON and that `functions_analyzed > 0`. Non-JSON stdout or
   `functions_analyzed: 0` means the scan did not run; report "scan
   unavailable", never "no dead code found".
2. **`semantic` is not compiled into the prebuilt binary**
   (`unrecognized subcommand 'semantic'`). Only `search` exists — BM25
   lexical search, not embedding-based, so phrase choice matters more than it
   would for a true semantic search.
3. **`vuln` misclassifies vulnerability types.** It found a real taint flow
   but labelled an `execSync` command injection `sql_injection`/CWE-89.
   `taint_flow` location is trustworthy; `vuln_type`, `cwe_id`, and
   `remediation` are not.

`dead_functions` is advisory only wherever it feeds an auto-remove workflow
(`deslopper`, `nuclear-review`) — confirm every candidate with `Grep` before
deleting anything, regardless of engine.
