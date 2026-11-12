import { apiPath } from "./constants.ts";
import { siteReader } from "./reader.ts";

/** The draft mode and publish routes under the API path, ahead of the site's own chain (the `middleware` of `sanity()`). */
export default async function sanityRoutes(
  { request }: { request: Request },
  next: () => Promise<Response>
): Promise<Response> {
  const base = `${apiPath()}/`;
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith(base)) {
    return await next();
  }

  const action = pathname.slice(base.length);

  if (action.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  return await siteReader().route(request, action);
}

/** The Cloudflare test checks its copy against this one. */
export { BYPASS_COOKIE } from "./constants.ts";
