# Local skill routing evaluation — 2026-09-21

**Decision: do not add model-based skill routing to either host.** Three
candidates, Laya MLX and two Jev formulations, failed the quality and latency
gates. Claude Code and Codex keep choosing skills the way they do now: the host
model reads each skill's description, and `/name` or `$name` pins a skill
explicitly.

The question was whether a classifier could suggest relevant optional skills
for a request without weakening explicit invocation, mandatory instructions, or
permission checks. A 2026-09-19 measurement on real transcripts had already
found that only 22 of 2,355 typed prompts led to a model-chosen skill; people
invoke skills with `/name`. This evaluation used synthetic requests to test
whether a classifier could do better anyway.

## Method

- Synthetic requests derived from the public skill catalog only (38 skills,
  7,413 description characters). No transcripts, user files, or third-party
  skill bodies entered model inputs. Baseline revision `eb5953e`.
- Each case was run in both Claude (`/name`) and Codex (`$name`) syntax.
  Development and held-out splits were separate. Labels, cutoffs, and
  thresholds were frozen before held-out inference and never tuned on held-out
  failures.
- One binary relevance question per skill, batched. This avoids fitting the
  whole catalog in one context: Laya's tokenizer counts the serialized catalog
  at 2,208 tokens against a 1,024-token window.
- Explicit host pins bypassed ranking deterministically in every run.

This is a small falsification pilot (86 rows in the first benchmark, 88 in the
second), not a statistical claim about all requests.

## Gates

| Gate | Threshold |
|---|---|
| Held-out recall | recall@3 ≥95% |
| False suggestions | ≤5% of all suggestions |
| No relevant skill | abstain on ≥95% |
| Explicit invocation | 100% preserved |
| Multilingual recall@3 | ≥90% |
| Adversarial requests | no irrelevant suggestions on 100% |
| Warm latency | p95 ≤250 ms per request, whole catalog |
| Host context | ≤256 added tokens |
| Gain over each live host | ≥5 points recall, measured |

## Results

| Held-out measurement | Laya MLX | Jev | Jev, host-aware, cap 2 |
|---|---:|---:|---:|
| Recall | 43.5% | 91.3% | 94.4% |
| False suggestions | 82.3% | 20.8% | 12.5% |
| Empty-label abstention | 10% | 100% | 100% |
| Multilingual recall | 37.5% | 100% | 100% |
| Adversarial, no irrelevant suggestions | 0% | 100% | 100% |
| Warm p50 / p95 | 466 / 1,409 ms | 315 / 429 ms | 322 / 444 ms |

Every candidate fails recall, false suggestions, and latency. The host-aware
run used a new, larger benchmark with required-skill groups, so its column is
not a measured improvement over the second.

- **Laya MLX** (`aac6fef/laya-multilingual-mlx` at revision `ba40c87`, Apple M1
  Max, MLX 0.32.2, FP16). Peak RSS was 1.15 GB and the checkpoint 678 MB, both
  within budget. Accuracy failed on every quality gate. Its timing overlapped
  other repository work, so the latency figure is not an isolated benchmark.
- **Jev** (`jev-1.13.0`, the same questions over TypeSafe's hosted API). It was
  much closer on quality. Many of its false suggestions were adjacent workflows
  (`refactor` with `hook`, `audit` with `triage`) that the frozen labels count
  as wrong. Network latency alone exceeds the 250 ms gate. The cost was
  est. $0.01 per run from reported tokens at $0.042 per million input tokens,
  not a billing receipt.
- **Host-aware Jev.** Development calibration picked cutoff 0.8 with at most
  two optional suggestions, which passed the development gates at 97.1% recall
  and zero false suggestions. On held-out cases, recall fell to 94.4%.
  Remaining errors: broad `build` suggestions on component requests, `oracle`
  on product positioning, and abstention on a legitimate review request that
  quoted hostile text.

## What was not measured

- **Live-host baseline.** Claude's `Skill` tool calls are observable, but a
  four-case Claude pilot produced only one complete, scoreable observation.
  Codex exposes skill-file reads, but native skill injection emits no event, so
  an absent read does not prove abstention. No gain over either host was
  measured.
- **Production behavior.** Server cold start and memory for Jev, timeouts,
  cancellation, fallback, install and uninstall, and real mandatory-trigger
  detection were not exercised, because no candidate passed the quality gates.

## If this is reopened

Establish a live-host baseline from observed tool events first; a model's
self-reported selection is not evidence. Compare a grouped-choice question or a
lexical shortlist on development cases only, and allocate fresh held-out cases
before scoring a tuned formulation. The 250 ms gate rules out any hosted
backend with this round-trip time. A local model has to beat Jev's quality to
be worth the packaging cost. Keep explicit invocation, mandatory instructions,
and permission checks outside any classifier.
