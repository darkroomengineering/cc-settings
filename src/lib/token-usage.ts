// Price-weighted token usage from Claude Code transcripts
// (~/.claude/projects/<slug>/<session>.jsonl plus <session>/subagents/*.jsonl).
// Pure parsing and aggregation; src/scripts/token-report.ts does the I/O.
//
// Claude Code writes one transcript line per content block, and every line of
// one API response repeats the same requestId and usage. Summing lines
// overcounts, so usage is deduped by requestId (message.id as fallback).

/** USD per million tokens. Cache writes bill at 1.25x input (5-minute TTL)
 *  or 2x input (1-hour TTL). Source: the bundled claude-api skill's model
 *  table (cached 2026-06-24); Fable 5.1 and Opus 5.5 publish their own cache
 *  read rates, the rest use the standard 0.1x. Figures are API-equivalent:
 *  on a subscription they measure share of the usage limit, not a bill. */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export const BILLING_TYPES = ["input", "write5m", "write1h", "cacheRead", "output"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export type Breakdown = Record<BillingType, number>;

export interface RequestUsage {
  id: string;
  model: string;
  tokens: Breakdown;
}

export interface Thread {
  /** "main", or the subagent's agentType from its meta.json. */
  kind: string;
  requests: RequestUsage[];
}

export interface SessionUsage {
  id: string;
  mtimeMs: number;
  main: Thread;
  subagents: Thread[];
}

export function zero(): Breakdown {
  return { input: 0, write5m: 0, write1h: 0, cacheRead: 0, output: 0 };
}

export function add(a: Breakdown, b: Breakdown): Breakdown {
  const out = zero();
  for (const k of BILLING_TYPES) out[k] = a[k] + b[k];
  return out;
}

/** Strip a `[1m]` window suffix and a `-YYYYMMDD` snapshot date so variants
 *  price as their base model. */
export function priceFor(model: string): ModelPrice | undefined {
  return PRICES[model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "")];
}

export function costOf(model: string, t: Breakdown): Breakdown {
  const p = priceFor(model);
  const out = zero();
  if (!p) return out;
  const m = 1e6;
  out.input = (t.input * p.input) / m;
  out.write5m = (t.write5m * p.input * 1.25) / m;
  out.write1h = (t.write1h * p.input * 2) / m;
  out.cacheRead = (t.cacheRead * p.cacheRead) / m;
  out.output = (t.output * p.output) / m;
  return out;
}

export function total(b: Breakdown): number {
  return BILLING_TYPES.reduce((s, k) => s + b[k], 0);
}

/** Tokens the model saw on one request: the full prompt, cached or not. */
export function promptSize(t: Breakdown): number {
  return t.input + t.write5m + t.write1h + t.cacheRead;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

/** One transcript's assistant requests, deduped, in order. Malformed lines
 *  and `<synthetic>` placeholder messages are skipped. */
export function parseTranscript(text: string): RequestUsage[] {
  const seen = new Set<string>();
  const out: RequestUsage[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = obj(JSON.parse(line));
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const message = obj(entry.message);
    const usage = obj(message?.usage);
    const model = typeof message?.model === "string" ? message.model : "";
    if (!usage || !model || model === "<synthetic>") continue;
    const id = String(entry.requestId ?? message?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const creation = obj(usage.cache_creation);
    const write5m = num(creation?.ephemeral_5m_input_tokens);
    const write1h = num(creation?.ephemeral_1h_input_tokens);
    // Older transcripts carry only the total; bill it at the 5-minute rate.
    const untyped = Math.max(0, num(usage.cache_creation_input_tokens) - write5m - write1h);
    out.push({
      id,
      model,
      tokens: {
        input: num(usage.input_tokens),
        write5m: write5m + untyped,
        write1h,
        cacheRead: num(usage.cache_read_input_tokens),
        output: num(usage.output_tokens),
      },
    });
  }
  return out;
}

export function threadCost(t: Thread): Breakdown {
  return t.requests.reduce((acc, r) => add(acc, costOf(r.model, r.tokens)), zero());
}

export function threadTokens(t: Thread): Breakdown {
  return t.requests.reduce((acc, r) => add(acc, r.tokens), zero());
}

/** Share of prompt tokens served from cache. */
export function cacheHitRate(t: Breakdown): number {
  const prompt = promptSize(t);
  return prompt === 0 ? 0 : t.cacheRead / prompt;
}

export interface Report {
  sessions: number;
  requests: { main: number; subagent: number };
  cost: { main: Breakdown; subagent: Breakdown };
  tokens: { main: Breakdown; subagent: Breakdown };
  /** Median prompt size of each thread's first request (the static prefix). */
  coldPrefix: { main: number; subagent: number };
  /** Median requests per session. */
  requestsPerSession: number;
  byModel: Record<string, number>;
  byAgent: Record<string, { spawns: number; requests: number; cost: number; coldPrefix: number }>;
  unpricedModels: string[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function buildReport(sessions: SessionUsage[]): Report {
  const report: Report = {
    sessions: sessions.length,
    requests: { main: 0, subagent: 0 },
    cost: { main: zero(), subagent: zero() },
    tokens: { main: zero(), subagent: zero() },
    coldPrefix: { main: 0, subagent: 0 },
    requestsPerSession: 0,
    byModel: {},
    byAgent: {},
    unpricedModels: [],
  };
  const unpriced = new Set<string>();
  const mainCold: number[] = [];
  const subCold: number[] = [];
  const agentCold: Record<string, number[]> = {};
  const perSession: number[] = [];

  const tally = (t: Thread) => {
    for (const r of t.requests) {
      if (!priceFor(r.model)) unpriced.add(r.model);
      const c = total(costOf(r.model, r.tokens));
      report.byModel[r.model] = (report.byModel[r.model] ?? 0) + c;
    }
  };

  for (const s of sessions) {
    const main = s.main;
    tally(main);
    report.requests.main += main.requests.length;
    report.cost.main = add(report.cost.main, threadCost(main));
    report.tokens.main = add(report.tokens.main, threadTokens(main));
    const first = main.requests[0];
    if (first) mainCold.push(promptSize(first.tokens));
    let sessionRequests = main.requests.length;
    for (const sub of s.subagents) {
      tally(sub);
      sessionRequests += sub.requests.length;
      report.requests.subagent += sub.requests.length;
      const cost = threadCost(sub);
      report.cost.subagent = add(report.cost.subagent, cost);
      report.tokens.subagent = add(report.tokens.subagent, threadTokens(sub));
      const agent = report.byAgent[sub.kind] ?? { spawns: 0, requests: 0, cost: 0, coldPrefix: 0 };
      report.byAgent[sub.kind] = agent;
      agent.spawns++;
      agent.requests += sub.requests.length;
      agent.cost += total(cost);
      const subFirst = sub.requests[0];
      if (subFirst) {
        subCold.push(promptSize(subFirst.tokens));
        const cold = agentCold[sub.kind] ?? [];
        cold.push(promptSize(subFirst.tokens));
        agentCold[sub.kind] = cold;
      }
    }
    perSession.push(sessionRequests);
  }
  report.coldPrefix = { main: median(mainCold), subagent: median(subCold) };
  report.requestsPerSession = median(perSession);
  for (const [kind, cold] of Object.entries(agentCold)) {
    const agent = report.byAgent[kind];
    if (agent) agent.coldPrefix = median(cold);
  }
  report.unpricedModels = [...unpriced].sort();
  return report;
}

/** Claude Code's project directory name for a working directory. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}
