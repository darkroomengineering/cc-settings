/** Where the Markdown copy of a page is: `/index.md` for `/`, `/work/a.md` for `/work/a`. */
export function markdownPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");

  return `${trimmed || "/index"}.md`;
}

/** The page a Markdown path is the copy of, or none for any other path. */
export function pagePath(pathname: string): string | undefined {
  if (!pathname.endsWith(".md")) {
    return undefined;
  }

  const page = pathname.slice(0, -3);

  return page === "/index" ? "/" : page;
}

/** A path with a dot in its last segment is a file, never a page. */
const PAGE = /^\/(?:(?:[^/]+\/)*[^/.]+\/?)?$/u;

export const MARKDOWN = "text/markdown";

/** A page path whose `Accept` names `text/markdown`. Browsers never send it, so no `q` values are read. */
export function wantsMarkdown(url: URL, accept: string | null): boolean {
  return !!accept?.includes(MARKDOWN) && PAGE.test(url.pathname);
}
