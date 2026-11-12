/** Narrower than Solid Router's matcher, never wider: see DESIGN.md, Prerender. */
export function patternSource(pattern: string): string {
  const [head = "", splat] = pattern.split("/*", 2);
  const segments = head.split("/").filter(Boolean);
  let source = "";

  for (const segment of segments) {
    if (segment.startsWith(":")) {
      source += segment.endsWith("?") ? "(?:/[^/]+)?" : "/[^/]+";
    } else {
      source += `/${segment.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`;
    }
  }

  if (splat !== undefined) {
    source += "(?:/[^/]+)*";
  }

  if (!source) {
    return "^/$";
  }

  // `/:a?` and `/*rest` also match the root, which is `/`, not the empty string.
  const optional = segments.every((s) => s.startsWith(":") && s.endsWith("?"));

  return optional ? `^(?:/|${source})$` : `^${source}$`;
}

/** Whether the pattern has a param or a splat, so it stands for more than one path. */
export function isDynamic(pattern: string): boolean {
  return /[:*]/u.test(pattern);
}

/** Whether `path` is one of the pending paths or matches a pending pattern. */
export function isPending(path: string, pending: readonly string[]): boolean {
  return pending.some((p) => new RegExp(patternSource(p), "u").test(path));
}

/** A child's full path, relative to its layout's path `at`. */
export function relativeTo(at: string, full: string): string {
  if (full === "/" || at === "/" || !full.startsWith(at)) {
    return full;
  }

  return full.slice(at.length) || "/";
}
