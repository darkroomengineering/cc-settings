import { solidRouterPages } from "@solidjs/prerender";
import type { SolidRouterLike } from "@solidjs/prerender";
import { getRequestEvent, isServer } from "@solidjs/web";
import { HINT_HEADER } from "prerender-crawler/announce";

import type { RouterExtension } from "./extend.ts";

export function announce(paths: readonly string[]): void {
  const event = isServer ? getRequestEvent() : undefined;

  if (
    !event?.response ||
    event.response.committed ||
    paths.length === 0 ||
    !event.request.headers.has(HINT_HEADER)
  ) {
    return;
  }

  const had = event.response.headers.get(HINT_HEADER);
  event.response.headers.set(
    HINT_HEADER,
    [...(had ? [had] : []), ...paths].join(",")
  );
}

export function announceRoutes(
  router: SolidRouterLike,
  extensions: readonly RouterExtension[]
): void {
  if (!isServer || !getRequestEvent()?.request.headers.has(HINT_HEADER)) {
    return;
  }

  announce(
    solidRouterPages(router).filter((path) =>
      extensions.every((extension) => extension.announced?.(path) ?? true)
    )
  );
}
