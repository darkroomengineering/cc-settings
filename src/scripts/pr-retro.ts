#!/usr/bin/env bun
// `/retro prs` helper: the counting half of the PR friction retro
// (skills/retro/references/prs.md). `collect` pulls merged PRs, review data
// and PR-less commits into a JSON bundle and marks the deterministic facts
// (bot, dependency bump, fix:, revert). Classification is model judgment and
// happens outside this script; `tally` reads the classified items back and does
// every count, percentage and line sum, so the report never carries a number
// a model estimated. Read-only on the target repo: gh reads, and git reads
// against a checkout or a blobless clone under ~/.claude/tmp.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE = `Usage:
  pr-retro collect [--repo owner/name] [--limit N | --since YYYY-MM-DD [--until YYYY-MM-DD]] [--path checkout] [--out dir]
  pr-retro tally --out dir [--no-save]`;

export const LOCKFILE =
  /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)$/;
const DEP_FILE = /(^|\/)(package\.json|\.npmrc|\.nvmrc|\.node-version)$/;
const BOT = /\[bot\]$|^app\/|^(dependabot|renovate|github-actions)$/i;
const COPILOT = /copilot/i;
const BODY_LIMIT = 6000;

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

export type Corrective = "fix" | "revert" | "candidate" | "no";
export type Skip = "bot" | "dep-bump" | null;

export interface ReviewFinding {
  author: string;
  path: string | null;
  body: string;
}

export interface PrRecord {
  number: number;
  title: string;
  author: string;
  mergedAt: string;
  labels: string[];
  additions: number;
  deletions: number;
  lines: number;
  files: FileStat[];
  type: string | null;
  corrective: Corrective;
  skip: Skip;
  body: string;
  bodyTruncated: boolean;
  reviews: {
    count: number;
    copilot: boolean;
    findings: ReviewFinding[];
    suppressed: number;
  } | null;
}

export interface CommitRecord {
  sha: string;
  subject: string;
  date: string;
  lines: number;
  files: string[];
  corrective: Corrective;
  skip: Skip;
}

/** Changed lines with generated lockfiles left out; they swamp a bump's real cost. */
export function linesWithoutLockfiles(files: FileStat[]): number {
  return files
    .filter((f) => !LOCKFILE.test(f.path))
    .reduce((n, f) => n + f.additions + f.deletions, 0);
}

export function conventionalType(title: string): string | null {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(title.trim());
  return m?.[1] ? m[1].toLowerCase() : null;
}

export function isRevert(title: string): boolean {
  return /^revert\b|^revert(\([^)]*\))?:/i.test(title.trim());
}

/** A bump that touches only manifests and lockfiles, whoever opened it. */
export function isDependencyBump(title: string, files: FileStat[]): boolean {
  if (files.length === 0) return false;
  const onlyDeps = files.every((f) => LOCKFILE.test(f.path) || DEP_FILE.test(f.path));
  return onlyDeps && /\b(deps?|bump|upgrade|update)\b/i.test(title);
}

export function skipReason(author: string, title: string, files: FileStat[]): Skip {
  if (BOT.test(author)) return "bot";
  if (isDependencyBump(title, files)) return "dep-bump";
  return null;
}

export function correctiveKind(title: string): Corrective {
  if (isRevert(title)) return "revert";
  const type = conventionalType(title);
  if (type === "fix" || type === "hotfix") return "fix";
  if (type === "feat") return "no";
  // chore/refactor/test/style/perf/ci/build/docs and unprefixed titles may repair
  // earlier work; the classifier decides, and the table says it was judgment.
  return "candidate";
}

// --- gh / git ---------------------------------------------------------------

async function sh(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0)
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${err.trim()}`);
  return out;
}

async function currentRepo(): Promise<string> {
  return (
    await sh(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
  ).trim();
}

async function checkoutFor(
  repo: string,
  path: string | undefined,
  scratch: string,
): Promise<string> {
  if (path) return path;
  try {
    const here = await currentRepo();
    if (here.toLowerCase() === repo.toLowerCase()) return process.cwd();
  } catch {}
  const clone = join(scratch, "clone");
  if (existsSync(join(clone, ".git"))) {
    await sh(["git", "-C", clone, "fetch", "--quiet", "origin"]);
  } else {
    await sh([
      "git",
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      `https://github.com/${repo}.git`,
      clone,
    ]);
  }
  return clone;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

interface RawReview {
  user?: { login?: string };
  body?: string;
}
interface RawComment {
  user?: { login?: string };
  body?: string;
  path?: string;
  in_reply_to_id?: number;
}

async function reviewsFor(
  repo: string,
  pr: number,
  prAuthor: string,
): Promise<PrRecord["reviews"]> {
  const [reviews, comments] = await Promise.all([
    sh(["gh", "api", "--paginate", `repos/${repo}/pulls/${pr}/reviews`]).then(
      (s) => JSON.parse(s || "[]") as RawReview[],
    ),
    sh(["gh", "api", "--paginate", `repos/${repo}/pulls/${pr}/comments`]).then(
      (s) => JSON.parse(s || "[]") as RawComment[],
    ),
  ]);
  let suppressed = 0;
  for (const r of reviews) {
    const m = /comments? suppressed[^\d]*(\d+)|(\d+)\s+comments? suppressed/i.exec(r.body ?? "");
    if (m) suppressed += Number(m[1] ?? m[2]);
  }
  const findings: ReviewFinding[] = comments
    .filter((c) => !c.in_reply_to_id && c.user?.login !== prAuthor)
    .map((c) => ({
      author: c.user?.login ?? "unknown",
      path: c.path ?? null,
      body: (c.body ?? "").slice(0, 600),
    }));
  return {
    count: reviews.length,
    copilot: reviews.some((r) => COPILOT.test(r.user?.login ?? "")),
    findings,
    suppressed,
  };
}

interface RawPr {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  mergedAt: string;
  labels: { name: string }[];
  additions: number;
  deletions: number;
  files: FileStat[];
}

async function collect(args: Map<string, string>): Promise<void> {
  const repo = args.get("repo") ?? (await currentRepo());
  const slug = repo.replace("/", "__");
  const date = new Date().toISOString().slice(0, 10);
  const scratch = join(homedir(), ".claude", "tmp", "pr-retro", slug);
  const out = args.get("out") ?? join(scratch, date);
  await mkdir(out, { recursive: true });

  const since = args.get("since");
  const until = args.get("until");
  const limit = Number(args.get("limit") ?? (since ? 1000 : 150));
  if (!Number.isInteger(limit) || limit < 1) throw new Error(USAGE);
  const listCmd = [
    "gh",
    "pr",
    "list",
    "-R",
    repo,
    "--state",
    "merged",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,author,files,mergedAt,labels,additions,deletions",
  ];
  if (since) listCmd.push("--search", `merged:${since}..${until ?? "*"}`);
  const raw = (JSON.parse(await sh(listCmd)) as RawPr[]).sort((a, b) => a.number - b.number);
  if (raw.length === 0) throw new Error(`no merged PRs in ${repo} for this window`);

  const prs: PrRecord[] = raw.map((p) => {
    const files = (p.files ?? []).map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));
    const skip = skipReason(p.author.login, p.title, files);
    return {
      number: p.number,
      title: p.title,
      author: p.author.login,
      mergedAt: p.mergedAt,
      labels: p.labels.map((l) => l.name),
      additions: p.additions,
      deletions: p.deletions,
      lines: linesWithoutLockfiles(files),
      files,
      type: conventionalType(p.title),
      corrective: skip ? "no" : correctiveKind(p.title),
      skip,
      body: (p.body ?? "").slice(0, BODY_LIMIT),
      bodyTruncated: (p.body ?? "").length > BODY_LIMIT,
      reviews: null,
    };
  });

  const human = prs.filter((p) => !p.skip);
  const reviews = await mapLimit(human, 8, (p) => reviewsFor(repo, p.number, p.author));
  human.forEach((p, i) => {
    p.reviews = reviews[i] ?? null;
  });

  const first = prs[0] as PrRecord;
  const last = prs.at(-1) as PrRecord;
  const checkout = await checkoutFor(repo, args.get("path"), scratch);
  await sh(["git", "-C", checkout, "fetch", "--quiet", "origin"]).catch(() => {});
  const startIso = since ?? prs.map((p) => p.mergedAt).sort()[0];
  const endIso =
    until ??
    prs
      .map((p) => p.mergedAt)
      .sort()
      .at(-1);
  const log = await sh([
    "git",
    "-C",
    checkout,
    "log",
    "origin/HEAD",
    "--no-merges",
    `--since=${startIso}`,
    ...(endIso ? [`--until=${endIso}`] : []),
    "--format=@@%H|%aI|%s",
    "--numstat",
  ]);
  const commits: CommitRecord[] = [];
  for (const block of log.split("@@").filter(Boolean)) {
    const [head, ...rest] = block.trim().split("\n");
    const [sha, dateIso, ...subj] = (head ?? "").split("|");
    const subject = subj.join("|");
    if (/\(#\d+\)\s*$/.test(subject) || /^Merge /.test(subject)) continue;
    const files = rest.map((l) => l.split("\t")).filter((c) => c.length === 3);
    const stats = files.map(([a, d, path]) => ({
      path: path ?? "",
      additions: Number(a) || 0,
      deletions: Number(d) || 0,
    }));
    commits.push({
      sha: sha ?? "",
      subject,
      date: dateIso ?? "",
      lines: linesWithoutLockfiles(stats),
      files: stats.map((s) => s.path),
      skip: isDependencyBump(subject, stats) ? "dep-bump" : null,
      corrective: isDependencyBump(subject, stats) ? "no" : correctiveKind(subject),
    });
  }

  const reviewed = human.filter((p) => (p.reviews?.count ?? 0) > 0);
  const copilotPrs = human.filter((p) => p.reviews?.copilot).map((p) => p.number);
  const counts = {
    merged: prs.length,
    skippedBot: prs.filter((p) => p.skip === "bot").length,
    skippedDepBump: prs.filter((p) => p.skip === "dep-bump").length,
    considered: human.length,
    fixPrs: human.filter((p) => p.corrective === "fix").length,
    revertPrs: human.filter((p) => p.corrective === "revert").length,
    candidatePrs: human.filter((p) => p.corrective === "candidate").length,
    featPrs: human.filter((p) => p.corrective === "no").length,
    reviewFindings: human.reduce((n, p) => n + (p.reviews?.findings.length ?? 0), 0),
    suppressedReviewComments: human.reduce((n, p) => n + (p.reviews?.suppressed ?? 0), 0),
    reviewedPrs: reviewed.length,
    unreviewedPrs: human.length - reviewed.length,
    copilotReviewedPrs: copilotPrs.length,
    lastCopilotReviewedPr: copilotPrs.at(-1) ?? null,
    prlessCommits: commits.length,
    prlessSkippedDepBump: commits.filter((c) => c.skip).length,
    prlessFixCommits: commits.filter((c) => c.corrective === "fix" || c.corrective === "revert")
      .length,
    prlessCandidateCommits: commits.filter((c) => c.corrective === "candidate").length,
  };
  const bundle = {
    repo,
    checkout,
    generatedAt: new Date().toISOString(),
    window: {
      limit: since ? null : limit,
      since: since ?? null,
      until: until ?? null,
      firstPr: first.number,
      lastPr: last.number,
      firstMergedAt: startIso,
      lastMergedAt: endIso,
    },
    counts,
    prs,
    commits,
  };
  await writeFile(join(out, "collect.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify({ out, repo, window: bundle.window, counts }, null, 2));
}

// --- tally ------------------------------------------------------------------

export interface Item {
  id: string;
  source: "pr" | "review" | "commit";
  pr: number | null;
  sha: string | null;
  title: string;
  corrective: boolean;
  bucket: string;
  reason: string;
  quirk: boolean;
  bundled: boolean;
  evidence: "diff" | "title-body";
  files?: string[];
}

export interface BucketRow {
  bucket: string;
  count: number;
  pct: number;
  lines: number;
  linesPct: number;
  quirks: number;
}

/** Lines an item cost: its own files when a bundled PR was split, else the whole PR. Review findings carry 0. */
export function itemLines(
  item: Item,
  prs: Map<number, PrRecord>,
  commits: Map<string, CommitRecord>,
): number {
  if (item.source === "review") return 0;
  if (item.source === "commit") return commits.get(item.sha ?? "")?.lines ?? 0;
  const pr = prs.get(item.pr ?? -1);
  if (!pr) return 0;
  if (!item.files?.length) return pr.lines;
  const wanted = new Set(item.files);
  return linesWithoutLockfiles(pr.files.filter((f) => wanted.has(f.path)));
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export function tallyItems(
  items: Item[],
  lines: (i: Item) => number,
): { rows: BucketRow[]; total: number; totalLines: number } {
  const corrective = items.filter((i) => i.corrective);
  const totalLines = corrective.reduce((n, i) => n + lines(i), 0);
  const by = new Map<string, Item[]>();
  for (const i of corrective) by.set(i.bucket, [...(by.get(i.bucket) ?? []), i]);
  const rows = [...by].map(([bucket, list]) => {
    const l = list.reduce((n, i) => n + lines(i), 0);
    return {
      bucket,
      count: list.length,
      pct: pct(list.length, corrective.length),
      lines: l,
      linesPct: pct(l, totalLines),
      quirks: list.filter((i) => i.quirk).length,
    };
  });
  rows.sort((a, b) => b.count - a.count || b.lines - a.lines);
  return { rows, total: corrective.length, totalLines };
}

async function readItems(dir: string): Promise<Item[]> {
  const items: Item[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort()) {
    for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
      if (line.trim()) items.push(JSON.parse(line) as Item);
    }
  }
  return items;
}

async function tally(args: Map<string, string>): Promise<void> {
  const out = args.get("out");
  if (!out) throw new Error(USAGE);
  const bundle = JSON.parse(await readFile(join(out, "collect.json"), "utf8")) as {
    repo: string;
    window: Record<string, unknown>;
    counts: Record<string, number | null>;
    prs: PrRecord[];
    commits: CommitRecord[];
  };
  const buckets = JSON.parse(await readFile(join(out, "buckets.json"), "utf8")) as {
    buckets: string[];
  };
  const items = await readItems(join(out, "classified"));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) problems.push(`duplicate item id ${i.id}`);
    seen.add(i.id);
    if (i.corrective && !buckets.buckets.includes(i.bucket))
      problems.push(`${i.id}: unknown bucket "${i.bucket}"`);
    if (i.evidence !== "diff" && i.evidence !== "title-body")
      problems.push(`${i.id}: evidence must be "diff" or "title-body"`);
  }
  // Every fix, revert and candidate must come back judged, or the counts silently shrink.
  const covered = new Set(items.filter((i) => i.source === "pr").map((i) => i.pr));
  for (const p of bundle.prs)
    if (!p.skip && p.corrective !== "no" && !covered.has(p.number))
      problems.push(`#${p.number} (${p.corrective}) has no classified item`);
  const coveredShas = new Set(items.filter((i) => i.source === "commit").map((i) => i.sha));
  for (const c of bundle.commits)
    if (!c.skip && c.corrective !== "no" && !coveredShas.has(c.sha))
      problems.push(`${c.sha.slice(0, 7)} (${c.corrective}) has no classified item`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }

  const prs = new Map(bundle.prs.map((p) => [p.number, p]));
  const commits = new Map(bundle.commits.map((c) => [c.sha, c]));
  const lines = (i: Item) => itemLines(i, prs, commits);
  const { rows, total, totalLines } = tallyItems(items, lines);
  const corrective = items.filter((i) => i.corrective);
  const top = Object.fromEntries(
    rows.map((r) => [
      r.bucket,
      corrective
        .filter((i) => i.bucket === r.bucket)
        .sort((a, b) => lines(b) - lines(a))
        .slice(0, 5)
        .map((i) => ({ id: i.id, pr: i.pr, sha: i.sha, title: i.title, lines: lines(i) })),
    ]),
  );
  const prItems = corrective.filter((i) => i.source === "pr");
  const summary = {
    repo: bundle.repo,
    window: bundle.window,
    counts: {
      ...bundle.counts,
      classifiedItems: items.length,
      correctiveItems: total,
      correctiveFromPrs: prItems.length,
      correctiveFromReviews: corrective.filter((i) => i.source === "review").length,
      correctiveFromCommits: corrective.filter((i) => i.source === "commit").length,
      candidatesRejected: items.filter((i) => !i.corrective).length,
      bundledPrs: new Set(prItems.filter((i) => i.bundled).map((i) => i.pr)).size,
      readDiff: items.filter((i) => i.evidence === "diff").length,
      readTitleBodyOnly: items.filter((i) => i.evidence !== "diff").length,
      quirkItems: corrective.filter((i) => i.quirk).length,
      correctiveLines: totalLines,
    },
    buckets: rows,
    top,
  };

  const md = [
    "| Item | Source | Title | Bucket | Reason | Quirk | Lines | Bundled | Evidence |",
    "|---|---|---|---|---|---|---|---|---|",
    ...corrective
      .sort((a, b) => (a.pr ?? 0) - (b.pr ?? 0))
      .map(
        (i) =>
          `| ${i.pr ? `#${i.pr}` : (i.sha ?? "").slice(0, 7)} | ${i.source} | ${cell(i.title)} | ${i.bucket} | ${cell(i.reason)} | ${i.quirk ? "yes" : "no"} | ${lines(i)} | ${i.bundled ? "yes" : "no"} | ${i.evidence} |`,
      ),
  ].join("\n");
  await writeFile(join(out, "table.md"), `${md}\n`);
  await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  const store = join(homedir(), ".claude", "retros", bundle.repo.replace("/", "__"));
  let previous: unknown = null;
  if (existsSync(store)) {
    const snaps = (await readdir(store)).filter((n) => /^prs-.*\.json$/.test(n)).sort();
    const last = snaps.at(-1);
    if (last) previous = JSON.parse(await readFile(join(store, last), "utf8"));
  }
  if (args.get("no-save") === undefined) {
    await mkdir(store, { recursive: true });
    const snapshot = {
      date: new Date().toISOString().slice(0, 10),
      window: bundle.window,
      correctiveItems: total,
      buckets: Object.fromEntries(
        rows.map((r) => [r.bucket, { pct: r.pct, linesPct: r.linesPct, count: r.count }]),
      ),
    };
    await writeFile(
      join(store, `prs-${snapshot.date}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify({ ...summary, previous, table: join(out, "table.md") }, null, 2));
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) throw new Error(USAGE);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args.set(a.slice(2), "");
    else {
      args.set(a.slice(2), next);
      i++;
    }
  }
  return args;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    const args = parseArgs(rest);
    if (cmd === "collect") await collect(args);
    else if (cmd === "tally") await tally(args);
    else throw new Error(USAGE);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
