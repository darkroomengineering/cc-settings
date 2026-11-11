# Audit: State mode

Find every implicit state machine in the repo, prove which ones can reach an impossible state, and turn the rest into a ranked conversion backlog. The signs and the target shape are in AGENTS.md → No Implicit State Machines; the guardrail converts machines opportunistically as diffs touch them, and this mode finds the ones no diff has reached. Rides the Shared Contract in `SKILL.md`; finding IDs use the `F` prefix in Full mode.

**Role additions:** a user who double-clicks, navigates away mid-request, and retries after an error; the next maintainer, about to add one more flag; an agent editing the file, which copies whatever shape it finds.

**Scope.** All code that holds lifecycle state: components, hooks, stores, reducers, context providers, route handlers, background jobs, and persisted records whose columns or schema fields encode a lifecycle (`status` next to `isDraft` and `publishedAt`). Skip generated and vendored code.

**Sweep.** Grep for leads, then read each hit's owner in full; a grep hit is never a finding on its own:

```bash
rg -n -g '!node_modules' -g '!dist' -g '!build' \
  -e 'use(State|Ref)\((true|false|null)\)' \
  -e '\bis[A-Z][A-Za-z]*(Loading|Error|Open|Pending|Submitting|Closing|Success|Done)\b' \
  -e '\bstatus\??\s*[:=]'
```

Also read effects whose dependencies are flags, `finally` blocks that reset flags, and refs used as re-entry guards.

**Per machine, record:** the `file:line` of the state declarations; the states it can really be in, named; each transition and what triggers it; the impossible combinations the current shape permits; and whether one is reachable, with the input sequence that reaches it. Then the target shape, so the conversion is mechanical.

**Target shape.** Pick the first that holds, and name the rungs you rejected:
1. Derive or delete: a flag computable from other state, or owned by the URL or the server, stops being state.
2. A tagged union with one transition function, with the union and the function's signature written out.
3. A reducer, when transitions need the previous state's data or come from many call sites.
4. A state-machine library, only if the project already uses one.

Justify the pick in one line each for the user (which stuck or wrong screen goes away), the developer (which invariant the type now holds), and agents (where the next edit lands instead of a new flag). Then name the behavior the conversion must keep and the test that pins it, or "none: write it first", so the implementer can prove nothing broke.

**Severity:**
- **HIGH:** a reachable impossible state that shows wrong UI, loses data, double-submits, or strands the user (input disabled forever, a spinner beside an error). CONFIRMED needs the input sequence and the `file:line` of the missing transition.
- **MEDIUM:** impossible combinations that are representable but held off only by convention (every setter called in the right pairs), or a persisted lifecycle whose fields can disagree.
- **LOW:** sound today, but the next flag breaks it (two booleans, one effect chained on another).

**Map section:** one row per machine, sorted by severity so it doubles as the backlog: location, states, transitions, impossible states, reachable (yes/no), severity, target shape, owning module.

**Handoff.** Like every mode here, State mode never edits source. After the report, ask once (AskUserQuestion; Codex `request_user_input`) which findings to convert now and which to ticket. Converting goes to the `implementer` agent, or `/fix` for a HIGH that is a live bug. Ticketing files one issue per machine with its map row and target union: through the `linear` agent's `follow-up` event in a repo with a Linear mapping, otherwise `gh issue create`. Machines neither converted nor ticketed are left to the guardrail, which converts them when a diff next edits them.
