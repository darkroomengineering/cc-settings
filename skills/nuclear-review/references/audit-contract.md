# Shared audit contract

Single source of truth for the plumbing `/nuclear-review` and `/adversarial-audit` share. Mode-specific hunt categories, prompts, and report templates stay in each skill; the three procedures below are identical by design and must not be re-derived inline. Installed path: `~/.claude/skills/nuclear-review/references/audit-contract.md`.

## 1. Cross-model pass (Codex bridge) — gated, fails open

A whole-repo audit is one model family judging alone, biased toward the abstractions it would have written. When the Codex bridge is available, get an independent read from a different family. There is **no diff** in a whole-repo audit, so use `ask`, not `review`:

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" ask "<the skill's audit prompt>"
```

Fold Codex's findings into synthesis as a second opinion: where Claude and Codex independently flag the same module, that's **high-conviction**; where they diverge, note the divergence rather than silently dropping it. The bridge is gated and fails open — if Codex is unavailable, proceed with the Claude-only audit.

## 2. team-knowledge reconciliation — gated, fails open

Structure-blind auditing means deliberate design reads as debt. Reconcile findings against the `team-knowledge` corpus — the record of "we decided to do it this way" and "this bites you."

**Reconcile AFTER the findings exist, never before.** Feeding the corpus in first biases the critic into rubber-stamping "the way we do things" — the exact independence the audit exists to protect. Generate blind, cross-reference after.

```bash
REPO="${KNOWLEDGE_REPO:-darkroomengineering/team-knowledge}"
gh api repos/$REPO/contents/INDEX.md --jq .content | base64 -d
```

Read any note a finding plausibly touches, then reclassify each finding — **reclassify severity, never delete the finding**:

- **Novel debt** (no matching note) → act, as normal.
- **Touches a documented decision** → keep it, tag `⚠ Documented / By-Design — high bar to act, needs team discussion`, and route it to humans instead of auto-fixing. The rare case where the audit is right *despite* the decision (it went stale) survives as an escalation instead of being silently dropped.
- **Already-known-deferred** → cite the note and deprioritize.

The invariant is absolute: team-knowledge **reclassifies** a finding's severity; it never **suppresses** one. If documented decisions became a silent veto, the codebase ossifies — challenging "the way we do things" is the whole point of an audit. Notes are falsifiable priors, not gospel — verify a note is still current before treating it as binding; a stale decision is itself a finding.

Gated, fails open: if the corpus is unreachable (no `$KNOWLEDGE_REPO`, no network, non-Darkroom repo), proceed with unreconciled findings. These skills must not hard-depend on a private repo.

## 3. Finding contract

What makes findings executable by fixing agents instead of prose to nod at:

- **Stable finding IDs** — number every finding in severity order (`N1`, `N2`, … or the skill's prefix scheme) so fixes, PRs, and discussion cite them without re-describing.
- **CONFIRMED vs PLAUSIBLE** — mark each finding CONFIRMED (traced to the lines that prove it, or reproduced) or PLAUSIBLE (suspected, not fully traced).
- **Disprove first** — before reporting a finding, actively try to refute it; discard what doesn't survive. A shorter list of survivors beats a long list of maybes.
- **Concrete scenario** — every finding needs specific inputs/state leading to the wrong or surprising result. No vague "could be improved."
- **Considered & rejected ledger** — candidate findings investigated and disproved (or reclassified as by-design), each with a one-line reason. This ledger is what stops the next audit from re-litigating them — check it before hunting.
