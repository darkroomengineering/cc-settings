// Canonical keyed set arithmetic for the installer's merge/strip paths.
//
// Four call sites previously hand-rolled the same Set-based filters:
//   - settings-merge.ts  unionPermissionArray     (string identity)
//   - settings-merge.ts  hooksStrategy            (JSON.stringify identity)
//   - light-profile.ts   stripManagedSettings     (JSON.stringify / key identity)
//   - mcp.ts             removeManagedMcpServers  (object-key identity)
//
// Both helpers are order-preserving and dedup ACROSS sides only: duplicates
// within one input survive, matching the loops they replaced exactly.

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
