const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * The href of a link from content, or `undefined` when it would run script.
 * Web, mail and phone links pass, and so do relative ones and fragments; any
 * other scheme (`javascript:`, `data:`) is dropped. Solid, unlike React, sets
 * a `javascript:` href as it is.
 */
export function safeHref(href: unknown): string | undefined {
  if (typeof href !== "string") {
    return undefined;
  }

  // The browser ignores control characters and spaces when it reads the scheme.
  const bare = [...href].filter((char) => char > " ").join("");
  const scheme = /^[a-z][a-z\d+.\-]*:/iv.exec(bare);

  return !scheme || SAFE_SCHEMES.has(scheme[0].toLowerCase())
    ? href
    : undefined;
}
