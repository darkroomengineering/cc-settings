---
name: retro
description: |
  Weekly engineering retrospective with persistent metrics. Use when:
  - User says "retro", "retrospective", "weekly review"
  - User asks "how was my week?", "engineering metrics", "velocity"
  - User wants to analyze commit patterns, work sessions, or code quality trends
  - User says "what did I ship?", "show me my stats"
context: fork
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

# Engineering Retrospective

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "retro" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

Analyze commit history to produce velocity metrics, work patterns, and improvement suggestions with persistent history for trend tracking.

**This skill is self-contained.** Do not read CLAUDE.md or agent definitions.

## Arguments

- `/retro` — last 7 days (default)
- `/retro 24h` or `/retro 14d` or `/retro 30d` — custom window
- `/retro compare` — current 7d vs prior 7d
- `/retro compare 14d` — current 14d vs prior 14d

**Validation:** Only accept arguments matching `\d+[dhw]`, `compare`, or `compare \d+[dhw]`. Reject anything else with usage instructions.

---

## Step 1: Gather Raw Data

Fetch latest from remote, then run 5 parallel git commands:

```bash
# Fetch latest
git fetch origin main 2>/dev/null

# 1. Commits with timestamps, subject, hash, and stats
git log origin/main --since="WINDOW_START" --format="%H|%aI|%s" --shortstat

# 2. Per-commit numstat for test vs production LOC breakdown
# Test files: paths matching test/|spec/|__tests__|*.test.|*.spec.
git log origin/main --since="WINDOW_START" --format="%H" --numstat

# 3. Sorted commit timestamps for session detection (local timezone)
git log origin/main --since="WINDOW_START" --format="%aI" | sort

# 4. Hotspot analysis (most frequently changed files)
git log origin/main --since="WINDOW_START" --format="" --name-only | sort | uniq -c | sort -rn | head -20

# 5. PR number extraction from commit messages (#NNN patterns)
git log origin/main --since="WINDOW_START" --format="%s" | grep -oE '#[0-9]+' | sort -u
```

Replace `WINDOW_START` with the appropriate `--since` value for the requested window.

---

## Step 2: Compute Metrics

Build a summary table:

```
| Metric                | Value          |
|-----------------------|----------------|
| Commits to main       | N              |
| PRs merged            | N              |
| Total insertions      | +N lines       |
| Total deletions       | -N lines       |
| Net LOC               | +/-N           |
| Test LOC              | N lines        |
| Test ratio            | N%             |
| Active days           | N/7            |
| Detected sessions     | N              |
| Avg LOC/session-hour  | ~N             |
```

---

## Step 3: Commit Time Distribution

Build an hourly histogram using local timezone. Identify:
- **Peak hours** — when most commits land
- **Dead zones** — hours with zero activity
- **Late-night clusters** — commits after 10pm (flag for sustainability)
- **Bimodal patterns** — morning + evening sessions

```
Hour  | Commits
------|---------
 8:00 | ###
 9:00 | ######
10:00 | ########
...
```

---

## Step 4: Work Session Detection

Use a **45-minute gap threshold** to detect session boundaries. Classify sessions:

| Type | Duration | Description |
|------|----------|-------------|
| **Deep** | 50+ min | Sustained focused work |
| **Medium** | 20-50 min | Moderate task work |
| **Micro** | <20 min | Quick fixes, reviews |

Calculate:
- Total active coding time
- Average session length
- LOC per hour (round to nearest 50)
- Ratio of deep sessions to total

---

## Step 5: Commit Type Breakdown

Categorize by conventional commit prefix:

```
feat:     N% (N commits)
fix:      N% (N commits)
refactor: N% (N commits)
test:     N% (N commits)
chore:    N% (N commits)
docs:     N% (N commits)
other:    N% (N commits)
```

**Flag:** Fix ratio > 50% may indicate a review gap or instability.

---

## Step 6: Hotspot Analysis

Top 10 most-changed files. For each:
- Change count
- Whether it's a test or production file
- **Churn flag** at 5+ changes — may indicate the file needs refactoring or splitting

---

## Step 7: PR Size Distribution

Bucket PRs by total LOC changed:

| Size | LOC Range | Count | Notes |
|------|-----------|-------|-------|
| Small | <100 | N | Ideal for review |
| Medium | 100-500 | N | Acceptable |
| Large | 500-1500 | N | Consider splitting |
| XL | 1500+ | N | Flag with file count |

---

## Step 8: Focus Score + Ship of the Week

**Focus Score:** Percentage of commits touching the single most-changed top-level directory. Higher = more focused work.

**Ship of the Week:** The highest-LOC PR with:
- PR number and title (from commit message)
- Total LOC changed
- Inferred significance

---

## Step 9: Week-over-Week Trends (if window >= 14d)

Split the window into weekly buckets. Track:
- Commits per week
- LOC per week
- Test ratio per week
- Fix ratio per week
- Session count per week

Show as a compact table with trend arrows.

---

## Step 10: Streak Tracking

Count consecutive days with at least 1 commit to `origin/main`, going back from today. Use full git history — no cutoff.

```bash
git log origin/main --format="%ad" --date=short | sort -u
```

Walk backward from today counting consecutive days.

---

## Step 11: Load History & Compare

Check for prior retro snapshots:

```bash
ls .context/retros/*.json 2>/dev/null | sort | tail -1
```

If found, load the most recent and calculate deltas:
- Test ratio change
- Session count change
- LOC/hour change
- Fix ratio change
- Commit count change
- Deep session count change

If none exist, note "First retro recorded."

---

## Step 12: Save Retro Snapshot

Save JSON to `.context/retros/YYYY-MM-DD.json`:

```bash
mkdir -p .context/retros
```

Schema:
```json
{
  "date": "YYYY-MM-DD",
  "window": "7d",
  "metrics": {
    "commits": 0,
    "prs": 0,
    "insertions": 0,
    "deletions": 0,
    "net_loc": 0,
    "test_loc": 0,
    "test_ratio": 0.0,
    "active_days": 0,
    "sessions": 0,
    "deep_sessions": 0,
    "avg_session_minutes": 0,
    "loc_per_session_hour": 0,
    "feat_pct": 0.0,
    "fix_pct": 0.0,
    "peak_hour": 0,
    "streak_days": 0
  },
  "summary": "Tweetable summary here"
}
```

---

## Step 13: Write the Narrative

Structure:

1. **Tweetable summary** (first line — one sentence capturing the week)
2. **Summary Table** (from Step 2)
3. **Trends vs Last Retro** (deltas from Step 11, or "First retro")
4. **Time & Session Patterns** — narrative prose about when and how you work
5. **Shipping Velocity** — commit type mix, PR size discipline, fix-chain detection
6. **Code Quality Signals** — test ratio, hotspots, XL PRs
7. **Focus & Highlights** — focus score, ship of the week
8. **Top 3 Wins** — best things that shipped
9. **3 Things to Improve** — concrete, specific, actionable
10. **3 Habits for Next Week** — small behavioral changes
11. **Week-over-Week Trends** (if applicable, from Step 9)

---

## Compare Mode

When `/retro compare` is used:

1. Compute metrics for the CURRENT window (e.g., last 7 days)
2. Compute metrics for the PRIOR window of same length (e.g., 7 days before that)
3. Use `--since` and `--until` to avoid overlap
4. Present side-by-side comparison table with deltas
5. Only save the CURRENT window snapshot to history

---

## Tone

- **Encouraging but candid** — no coddling, no generic praise
- Say exactly what was good and why
- Frame improvements as leveling up, not criticism
- Anchor everything in actual commits — no speculation
- ~2500-3500 words total
- Use markdown tables + prose

---

## Rules

- Always use `origin/main` — local-only commits are not shipped
- Use local timezone for display (detect from system)
- Handle zero-commit windows gracefully ("No commits in this window")
- Round LOC/hour to nearest 50
- Treat merge commits as PR boundaries
- This skill is self-contained — do not read CLAUDE.md or other docs
