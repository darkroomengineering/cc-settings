// Cold prompt-cache detection for src/hooks/cache-cold.ts.
//
// After the prompt cache expires, the next request in a large session writes
// the whole context to the cache again at the cache-write rate. The hook
// payload carries no cache state, so it is derived from the transcript: the
// newest main-thread assistant entry gives the time of the last cache use, the
// context size (input + cache read + cache write tokens), the model, and the
// TTL tier it wrote. Only the transcript tail is read; transcripts reach
// hundreds of MB.

import { open } from "node:fs/promises";
import { formatAge } from "./review-queue.ts";
import { costOf, total, zero } from "./token-usage.ts";

/** Smallest context worth a warning. Below it a cold re-send costs cents. */
export const COLD_RESEND_MIN_TOKENS = 100_000;

/** Bytes read from the end of the transcript. One large tool result can push
 *  the last assistant entry out of this window; the hook then stays silent. */
export const TAIL_BYTES = 4 * 1024 * 1024;

export const CACHE_TTL_MS = { "5m": 5 * 60_000, "1h": 60 * 60_000 } as const;
export type CacheTtl = keyof typeof CACHE_TTL_MS;

export interface LastUsage {
  /** Epoch ms of the assistant entry. */
  ts: number;
  model: string;
  /** Prompt tokens of that request: input + cache read + cache write. */
  tokens: number;
  /** "5m" only when the request wrote 5-minute cache entries and no 1-hour
   *  ones; otherwise the 1-hour TTL Claude Code uses for the main thread. */
  ttl: CacheTtl;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/** A main-thread assistant entry with real usage, or null. Synthetic entries
 *  (model `<synthetic>`: aborted turns, API errors) carry a fresh timestamp but
 *  no request, so they must not count as a cache use. */
export function parseUsageLine(line: string): LastUsage | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  const entry = parseLine(line);
  if (entry?.type !== "assistant" || entry.isSidechain === true) return null;
  const message = record(entry.message);
  const usage = record(message?.usage);
  const model = typeof message?.model === "string" ? message.model : "";
  const ts = Date.parse(typeof entry.timestamp === "string" ? entry.timestamp : "");
  if (!usage || !model || model.startsWith("<") || !Number.isFinite(ts)) return null;
  const tokens =
    num(usage.input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.cache_creation_input_tokens);
  if (tokens === 0) return null;
  const tiers = record(usage.cache_creation);
  const only5m =
    num(tiers?.ephemeral_5m_input_tokens) > 0 && num(tiers?.ephemeral_1h_input_tokens) === 0;
  return { ts, model, tokens, ttl: only5m ? "5m" : "1h" };
}

/** /compact and auto-compaction write this entry and no usage; the usage
 *  before it describes a context that no longer exists. */
function isCompactBoundary(line: string): boolean {
  if (!line.includes('"compact_boundary"')) return false;
  const entry = parseLine(line);
  return entry?.type === "system" && entry.subtype === "compact_boundary";
}

/** The newest usable assistant usage in the transcript's last `tailBytes`.
 *  Null when the file is missing or unreadable, when none is in the window, or
 *  when a compaction is newer than it. */
export async function readLastUsage(
  path: string,
  tailBytes: number = TAIL_BYTES,
): Promise<LastUsage | null> {
  let text: string;
  let partialFirst: boolean;
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      const start = Math.max(0, size - tailBytes);
      const buf = Buffer.alloc(size - start);
      await file.read(buf, 0, buf.length, start);
      text = buf.toString("utf8");
      partialFirst = start > 0;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
  const lines = text.split("\n");
  // The first line of a mid-file window is cut; never parse it.
  const first = partialFirst ? 1 : 0;
  for (let i = lines.length - 1; i >= first; i--) {
    const line = lines[i] as string;
    if (isCompactBoundary(line)) return null;
    const usage = parseUsageLine(line);
    if (usage) return usage;
  }
  return null;
}

export interface ColdResend {
  idleMs: number;
  ttl: CacheTtl;
  tokens: number;
  /** API-list-price estimate of re-writing the context; undefined for a model
   *  token-usage.ts has no price for. */
  usd?: number;
}

/** The re-send a prompt submitted at `now` pays, or null when the cache is
 *  still warm or the context is under `minTokens`. */
export function coldResend(
  last: LastUsage,
  now: number,
  minTokens: number = COLD_RESEND_MIN_TOKENS,
): ColdResend | null {
  const idleMs = now - last.ts;
  if (idleMs <= CACHE_TTL_MS[last.ttl] || last.tokens < minTokens) return null;
  const tokens = { ...zero(), [last.ttl === "1h" ? "write1h" : "write5m"]: last.tokens };
  const usd = total(costOf(last.model, tokens));
  return { idleMs, ttl: last.ttl, tokens: last.tokens, ...(usd > 0 && { usd }) };
}

function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

function formatUsd(usd: number | undefined): string {
  return usd === undefined ? "" : `, est. $${usd.toFixed(2)} at API list price`;
}

const TTL_LABEL: Record<CacheTtl, string> = { "5m": "5-minute", "1h": "1-hour" };

/** The user-facing warning for a cold re-send. */
export function coldResendMessage(c: ColdResend): string {
  return (
    `[Cache] ${formatAge(c.idleMs)} since the last reply, past the ${TTL_LABEL[c.ttl]} ` +
    `prompt-cache TTL (assumed from the session's cache writes), so this message re-sends ` +
    `${formatTokens(c.tokens)} tokens of context uncached${formatUsd(c.usd)}. ` +
    "If the earlier context is stale, /handoff then /clear starts the next task lighter."
  );
}
