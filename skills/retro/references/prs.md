# `/retro prs`: PR friction retro

Measures where corrective work went in a repo's merged PR history: which part
of the stack or tooling the fixes, reverts, repairs and substantive review
findings belong to, by count and by changed lines. It measures effort; it does
not start from the premise that any one framework is the problem. The answer
it supports is "which part of the stack or tooling deserves investment".

## Rules

- **Counted numbers only.** Every count, percentage and line sum comes from
  `pr-retro.ts`. Anything you infer (a trend reason, a root cause behind a
  bucket) is labelled `inferred`. Never estimate a count.
- **Read-only on the target repo.** `gh` reads and `git` reads only: no
  comments, labels, reviews, edits, branches or files in its tree. Artifacts go
  to `~/.claude/tmp/pr-retro/<owner>__<repo>/<date>/`, trend snapshots to
  `~/.claude/retros/<owner>__<repo>/`.
- **Neutral framing.** A bucket's size is where effort went, not a verdict on
  the library. A large framework bucket with few quirk flags is ordinary bug
  work; say so.
- **Standalone Codex:** there is no Agent fan-out; classify the batches
  serially in the session and say so in the caveats. The script is at
  `${CODEX_HOME:-$HOME/.codex}/darkroom/source/src/scripts/pr-retro.ts`.

## Arguments

After `prs`, all optional and in any order:

- `owner/name`: the target repo (default: the current one).
- `N`: the last N merged PRs (default 150).
- `YYYY-MM-DD..YYYY-MM-DD` (or `YYYY-MM-DD..`): a merge-date window in place
  of N.
- `buckets=a,b,c`: replace the derived bucket set.
- `path=/abs/checkout`: a local checkout of the target, to skip the clone.

## Step 1: Collect

```bash
RETRO="$HOME/.claude/src/scripts/pr-retro.ts"
bun "$RETRO" collect --repo OWNER/NAME [--limit N | --since A --until B] [--path CHECKOUT]
```

It prints `out` (the artifact directory) and `counts`, and writes
`$OUT/collect.json`. It already did, mechanically:

- skipped bot PRs (Dependabot, Renovate, any `[bot]` or `app/` author) and
  pure dependency bumps (only manifests and lockfiles changed, title says
  deps/bump/upgrade/update), and counted both;
- marked each remaining PR `fix` (`fix:`/`hotfix:`), `revert`, `no` (`feat:`),
  or `candidate` (every other prefix, or none);
- pulled reviews and inline review comments for every non-bot PR, dropping
  author replies and threaded replies, and counted Copilot's suppressed
  comments;
- listed PR-less commits on the default branch in the window, with the same
  kinds;
- counted lines from per-file stats with lockfiles excluded, so a bump never
  outweighs real work.

If it fails, report the error and stop. Do not substitute numbers.

## Step 2: Derive the buckets

Read the target's `package.json` (every workspace's, in a monorepo) and its
`AGENTS.md` (or `CLAUDE.md`). Name buckets after what the repo actually runs:

| Bucket | Holds |
|---|---|
| `framework:<name>` | The app framework and its runtime behavior (Next.js, React Router, Expo, Astro). One per framework present. |
| `ui:<name>` | The UI library (React, Vue, Svelte) when separate from the framework. |
| `styling` | CSS, CSS Modules, Tailwind, tokens, layout. |
| `animation-webgl` | GSAP, anime.js, Lenis, Theatre, three.js/R3F, shaders. |
| `integration:<name>` | One per integration found in deps or `lib/integrations` (Sanity, Shopify, HubSpot, Mailchimp). Roll them up in the summary. |
| `tooling` | Dependencies, lockfile, CI, lint and format config, build, scripts, test harness. |
| `docs-only` | A change that touches only docs. |
| `other` | App logic that belongs to none of the above. |

Bucket by root cause, not by file location. A library's bucket holds defects
that come from that library's model or behavior (a hook's semantics, a
rendering rule, a cache default). A bug in the repo's own logic goes where that
logic belongs: a component's broken form state is `other`, its wrong contrast
is `styling`, its scroll-offset math is `animation-webgl`. Put this rule in the
classifier brief with the bucket list.

`buckets=` replaces this set verbatim. Write the set before classifying:

```bash
echo '{"buckets":["framework:nextjs","ui:react","styling","animation-webgl","integration:sanity","tooling","docs-only","other"]}' > "$OUT/buckets.json"
```

## Step 3: Classify (fan out)

List what needs a judgment:

```bash
jq -r '.prs[] | select(.skip == null and (.corrective != "no" or (.reviews.findings | length) > 0)) | .number' "$OUT/collect.json"
jq -r '.commits[] | select(.skip == null and .corrective != "no") | .sha' "$OUT/collect.json"
```

Split that list into batches of about 12 and spawn one Sonnet subagent per
batch, all in one message: `Agent(subagent_type: "general-purpose", model:
"sonnet", ...)`. Each prompt carries the brief below with `$OUT`, the repo, the
bucket list, a batch number and its PR numbers or SHAs. Keep the subagents'
diffs out of your own context; you read only their JSONL.

> Classify corrective work in OWNER/NAME for a PR friction retro. Read-only:
> never comment on, label or edit the repo. Read each item's record with
> `jq '.prs[] | select(.number == N)' $OUT/collect.json` (commits:
> `.commits[] | select(.sha | startswith("SHA"))`). Read the diff, `gh pr diff
> N -R OWNER/NAME` (commits: `git -C CHECKOUT show SHA`), for every item whose
> kind is `candidate`, every item with `bodyTruncated: true`, and any other
> item whose title and body leave the root cause unclear. A title alone never
> settles a candidate. For a large diff, list files with `gh pr diff N
> --name-only` and read the hunks that matter (`| head -400`), not the whole
> thing. Write one JSON object per line to
> `$OUT/classified/batch-K.jsonl` and nothing else there.
>
> For each PR or commit, emit an item with: `id` (`pr-N`, `commit-SHA7`),
> `source` (`pr`/`commit`), `pr` (number or null), `sha` (full SHA or null),
> `title`, `corrective` (bool), `bucket` (one of BUCKETS), `reason` (one line:
> what was wrong and why it belongs in that bucket), `quirk` (bool), `bundled`
> (bool), `evidence` (`diff` if you read the diff, else `title-body`), and
> optional `files` (the paths that belong to this item). A `feat` PR is listed
> only for its review findings: emit its review items and no `pr-N` item.
>
> - `corrective` is true for `fix` and `revert` kinds unless the diff shows a
>   feature mislabelled as a fix; for `candidate` kinds it is true only when the
>   change repairs or reverts earlier work (a broken build, a regression, a
>   wrong config, drifted docs), and false for new work, planned refactors,
>   audits and routine upkeep. A false item still needs a bucket and reason.
> - Bucket by root cause, not file location: a library's bucket holds defects
>   from that library's model or behavior; a bug in the repo's own logic goes
>   where that logic belongs (`other`, `styling`, `animation-webgl`).
> - `quirk` is true only when the fix exists to work around the framework's or
>   library's own behavior (caching semantics, a bundler edge, a hydration
>   rule, a version-specific bug), not when it fixes a mistake in the repo's
>   own code.
> - A PR whose diff holds independent fixes in different buckets becomes one
>   item per fix (`pr-N-1`, `pr-N-2`), each with its `files` and
>   `bundled: true`. Otherwise one item for the headline fix, with
>   `bundled: true` if other unrelated changes ride along.
> - For each entry in the PR's `reviews.findings`, emit `review-N-K`
>   (`source: "review"`): `corrective` true only for a substantive defect the
>   reviewer found (a bug, a missed case, a broken contract); false for nits,
>   style, questions and praise.
>
> Reply with the file path, the item count, and how many diffs you read.

Check each reply's diff count against its batch's candidates and truncated
bodies. A batch that read fewer diffs than the brief requires goes back to the
same subagent (`SendMessage`) with the PR numbers it skipped.

When every batch is back, run Step 4. If `tally` reports a missing item,
send that item to a new subagent; do not fill it in yourself.

## Step 4: Tally

```bash
bun "$RETRO" tally --out "$OUT"
```

It validates the items (known buckets, no duplicates, every candidate
judged), then writes `$OUT/table.md` (PR, source, title, bucket, reason,
quirk, lines, bundled) and `$OUT/summary.json`, saves the bucket split to
`~/.claude/retros/<owner>__<repo>/prs-<date>.json`, and prints the summary
with the previous snapshot under `previous`.

## Step 5: Count framework rules

For each framework, UI library and animation library in the bucket set, list
the rules and workarounds the repo makes agents remember, from `AGENTS.md`,
`ARCHITECTURE.md`, nested `AGENTS.md` files and framework config
(`next.config.*`, `vite.config.*`, `app.json`):

```bash
grep -n -i -E 'next|cache|server component|use client|hydrat|turbopack' AGENTS.md ARCHITECTURE.md next.config.* 2>/dev/null
```

A rule is one instruction an agent must follow because of that library
(`never call X in Y`, `always wrap Z`, a config flag with a why-comment).
List each with `file:line` and count them. This count is yours, not the
script's, so list every rule you counted.

## Step 6: Check the window cut

Take the 3 topics that dominate the corrective items (a feature, a library, a
subsystem). For each, search the full history and report related work outside
the window:

```bash
git -C CHECKOUT log origin/HEAD --oneline -i -E --grep='TOPIC' | head -40
```

Report PR numbers before the window that belong to the same saga, so a
long-running fight is not understated by the cut.

## Step 7: Report

Chat summary, in this order:

1. **One line:** the biggest bucket by count and by lines, and the window.
2. **Bucket totals:** bucket, count, % of corrective items, lines, % of lines,
   quirks. Integrations rolled up, with the per-integration split under it.
3. **Quirks per framework**, with the rule count from Step 5 beside each.
4. **Top 5 most expensive items per framework bucket**, with PR numbers.
5. **Counts:** merged PRs, skipped (bots, dependency bumps), considered,
   candidates judged not corrective, corrective items by source.
6. **Trend:** each bucket's change since `previous`, or "first PR retro for
   this repo".
7. **2 to 3 recommendations**, ranked, each tied to one of the largest buckets
   and naming the PRs that motivate it. A recommendation that says why a
   bucket is large is `inferred`.
8. **Caveats** (always present):
   - the window cut and what Step 6 found outside it;
   - review coverage: PRs with no reviews, the last PR Copilot reviewed, and
     the likely reason if one is evident (`inferred`);
   - bundled PRs and how they were split;
   - review findings carry 0 lines, and lockfiles are excluded from lines;
   - the judgment calls that would move the numbers most (borderline
     candidates, quirk calls), each with its PR numbers;
   - which classifications read the diff and which read title and body only.

Then the paths to `table.md` and `summary.json`.
