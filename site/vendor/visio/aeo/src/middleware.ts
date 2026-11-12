import { markdownCopy } from "./markdown.ts";
import { markdownPath, pagePath, wantsMarkdown } from "./paths.ts";

/** The shape of a function in the chain `visio()` builds; this package does not depend on the router. */
type Middleware = (
  event: { request: Request },
  next: () => Promise<Response>
) => Response | Promise<Response>;

export interface MarkdownOptions {
  /** The build writes `llms.txt`, so a page names it. Default `false`. */
  llms?: boolean;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

function pageLinks(pathname: string, llms: boolean): string {
  const links = [
    `<${markdownPath(pathname)}>; rel="alternate"; type="text/markdown"`,
  ];

  if (llms) {
    links.push('</llms.txt>; rel="describedby"');
  }

  return links.join(", ");
}

function convert(
  request: Request,
  html: string,
  response: Response,
  url: string
): Response {
  // Without the query: a cached copy would keep the first visitor's `?utm_…`.
  const { origin, pathname } = new URL(url);
  const copy = markdownCopy(html, origin + pathname);
  const page = copy.head.canonical ?? origin + pathname;
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/markdown; charset=utf-8");
  headers.delete("content-length");
  headers.delete("content-encoding");
  const alternate = `<${page}>; rel="alternate"; type="text/html"`;

  if (copy.head.noindex) {
    headers.set("x-robots-tag", "noindex");
    headers.set("link", alternate);
  } else {
    headers.set("link", `<${page}>; rel="canonical", ${alternate}`);
  }

  const body = request.method === "HEAD" ? null : copy.markdown;

  return new Response(body, { status: 200, headers });
}

function toCopy(
  response: Response,
  from: URL,
  isPage: (pathname: string) => boolean
): Response {
  const location = response.headers.get("location");

  if (response.status < 300 || response.status > 399 || !location) {
    return response;
  }

  const to = new URL(location, from);
  const copy = markdownPath(to.pathname);

  if (
    to.origin !== from.origin ||
    !isPage(to.pathname) ||
    copy === markdownPath(from.pathname)
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("location", `${copy}${to.search}${to.hash}`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Answers `/path.md`, and `/path` whose `Accept` names `text/markdown`, with
 * the page as Markdown. `isPage` says which paths the route table has a page
 * at; every other request goes on as it came.
 */
export function markdownMiddleware(
  isPage: (pathname: string) => boolean,
  options: MarkdownOptions = {}
): Middleware {
  const llms = options.llms ?? false;

  return async (event, next) => {
    const { request } = event;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return next();
    }

    const url = new URL(request.url);
    const page = pagePath(url.pathname);

    if (page === undefined) {
      if (!isPage(url.pathname)) {
        return next();
      }

      const response = await next();

      if (!isHtml(response)) {
        return response;
      }

      const answer = new Response(response.body, response);
      answer.headers.append("vary", "Accept");

      if (answer.status !== 200) {
        return answer;
      }

      if (!wantsMarkdown(url, request.headers.get("accept"))) {
        answer.headers.append("link", pageLinks(url.pathname, llms));

        return answer;
      }

      return convert(request, await answer.text(), answer, url.href);
    }

    if (!isPage(page)) {
      return next();
    }

    const target = new URL(page + url.search, url);
    const headers = new Headers(request.headers);
    headers.set("accept", "text/html");
    // The chain hands on no request: everything after this reads `event.request`.
    event.request = new Request(target, { method: "GET", headers });
    const response = await next();

    if (response.status !== 200 || !isHtml(response)) {
      return toCopy(response, target, isPage);
    }

    return convert(request, await response.text(), response, target.href);
  };
}
