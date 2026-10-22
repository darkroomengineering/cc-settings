// Canonical keyed set arithmetic for the installer's merge/strip paths.
//
// Four call sites previously hand-rolled the same Set-based filters:
//   - settings-merge.ts  unionPermissionArray     (string identity)
//   - settings-merge.ts  hooksStrategy            (JSON.stringify identity)
//   - light-profile.ts   stripManagedSettings     (JSON.stringify / key identity)
//   - mcp.ts             removeManagedMcpServers  (object-key identity)
//
// Both keyed helpers are order-preserving and dedup ACROSS sides only:
// duplicates within one input survive, matching the loops they replaced
// exactly. `asRecord` lives here too — the shared coercion guard for reading
// record fields off unvalidated settings JSON across the same paths.

/**
 * Union keyed by `keyOf`: every `base` entry is kept in order, then every
 * `additions` entry whose key does not occur in `base` is appended in order.
 */
export function unionByKey<T>(base: T[], additions: T[], keyOf: (t: T) => string): T[] {
  const baseKeys = new Set(base.map(keyOf));
  return [...base, ...additions.filter((t) => !baseKeys.has(keyOf(t)))];
}

/**
 * Subtraction keyed by `keyOf`: the `items` whose key does not occur in
 * `baseline`, in their original order.
 */
export function subtractByKey<T>(items: T[], baseline: T[], keyOf: (t: T) => string): T[] {
  const baselineKeys = new Set(baseline.map(keyOf));
  return items.filter((t) => !baselineKeys.has(keyOf(t)));
}

/**
 * Within-array dedup keyed by `keyOf`: first occurrence wins, order preserved.
 * Opt-in companion to unionByKey/subtractByKey, which dedup across sides only.
 */
export function uniqueByKey<T>(items: T[], keyOf: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Canonical JSON identity: stringify with object keys sorted recursively, so
 * structurally-equal values hash identically regardless of key order. Claude
 * Code rewrites settings.json hook entries in its own field order (e.g.
 * `{async, timeout}` → `{timeout, async}`), so a raw JSON.stringify identity
 * treats the rewrite as a brand-new entry — the merger then re-appends it on
 * every install, one duplicate per setup run.
 */
export function canonicalKey(v: unknown): string {
  return JSON.stringify(sortKeysDeep(v));
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) out[k] = sortKeysDeep(rec[k]);
    return out;
  }
  return v;
}

/**
 * Coercion guard used across the installer's merge/strip paths: read a value
 * off unvalidated settings JSON as a record. Non-objects (including null and
 * undefined) degrade to an empty record instead of throwing on a bad shape;
 * arrays pass through (`typeof [] === "object"`), matching the inline
 * ternaries this replaced.
 */
export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/** True for a non-null, non-array object — the only JSON shape that carries
 *  named fields. Shared boundary guard for hook state IO and settings merge. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Top-level keys cc-settings used to ship and no longer does, with the exact
// value it shipped. Both the merge (settings-merge.ts) and the light/uninstall
// strip (light-profile.ts) prune from this one list. `plansDirectory` was
// "./plans" until it was removed: it wrote plan files into every repo, client
// repos included.
export const RETIRED_SCALAR_DEFAULTS: Readonly<Record<string, unknown>> = {
  plansDirectory: "./plans",
};

/**
 * True when `value` is the retired default cc-settings shipped under `key`. With
 * a baseline (the previous install's team settings), that baseline must have
 * supplied the same value: a baseline lacking the key means the user typed it
 * themselves, so it stays. Without a baseline, an exact match is pruned.
 */
export function isRetiredDefault(
  key: string,
  value: unknown,
  baseline: Record<string, unknown> | undefined,
): boolean {
  if (!(key in RETIRED_SCALAR_DEFAULTS)) return false;
  const retired = RETIRED_SCALAR_DEFAULTS[key];
  if (!Bun.deepEquals(value, retired, true)) return false;
  return baseline === undefined || Bun.deepEquals(baseline[key], retired, true);
}
