// Shared by the server, the browser and the Vite plugin, so it imports nothing.

export const DEFAULT_STUDIO_PATH = "/studio";
export const DEFAULT_API_PATH = "/api/sanity";

/** The Studio workspace, from the site's root. */
export const STUDIO_DIR = "../studio";

// The Studio plugin of sanity() defines both from its `studio` option. Without the define (a test,
// a script) the default stands.
export function studioPath(): string {
  return (
    // SAFETY: sanity() defines it as a string, or leaves it undefined.
    (import.meta.env.VISIO_SANITY_STUDIO as string | undefined) ??
    DEFAULT_STUDIO_PATH
  );
}

export function apiPath(): string {
  // SAFETY: sanity() defines it as a string, or leaves it undefined.
  return (
    (import.meta.env.VISIO_SANITY_API as string | undefined) ?? DEFAULT_API_PATH
  );
}

/** Set in draft mode and readable by the page, which loads the overlay on it. */
export const PERSPECTIVE_COOKIE = "sanity-preview-perspective";

/** The cache bypass cookie, Vercel's name, which is draft mode (draft.ts). */
export const BYPASS_COOKIE = "__prerender_bypass";

/** Pinned: GROQ behaviour only changes when this moves, and it moves with the package. */
export const API_VERSION = "2026-03-01";
