import type { ClientPerspective } from "@sanity/client";
import { useLocation, useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show } from "solid-js";

import { apiPath, PERSPECTIVE_COOKIE } from "./constants.ts";

interface HistoryUpdate {
  type: "push" | "pop" | "replace";
  url: string;
}

// Behind import(): a static `revalidate` puts Solid Router's query module and
// the whole server-function client in every visitor's entry chunk, for a call
// only a draft session makes.
async function refresh() {
  const module = await import("./refresh.ts");

  return module.refresh();
}

/** Whether the server took the new perspective; the page refetches when it did. Exported for tests. */
export async function followPerspective(
  perspective: ClientPerspective
): Promise<boolean> {
  let response: Response | undefined;

  try {
    response = await fetch(`${apiPath()}/perspective`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ perspective }),
    });
  } catch {
    // Offline: the warning below says so.
  }

  if (!response?.ok) {
    console.warn(
      `[@visio/sanity] The page could not switch to the Studio's perspective (${response?.status ?? "offline"}). ` +
        "The draft session has ended, most likely with a new deployment: open the preview again from the Studio."
    );

    return false;
  }

  await refresh();

  return true;
}

function draftSession(): boolean {
  return document.cookie
    .split("; ")
    .some((c) => c.startsWith(`${PERSPECTIVE_COOKIE}=`));
}

export interface VisualEditingProps {
  /** The site's exit from draft mode. */
  exit: (end: () => void) => JSX.Element;
  /** The site's switch for the overlay. */
  overlay: (shown: () => boolean, toggle: () => void) => JSX.Element;
}

export function VisualEditing(props: VisualEditingProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  function here() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  let tell: ((update: HistoryUpdate) => void) | undefined;
  const [outside, setOutside] = createSignal(false);
  const [shown, setShown] = createSignal(false);

  // A navigation from code, never a link: a browser prefetches a link, and a
  // prefetch of the disable route would end the session it should only show.
  function end() {
    window.location.assign(
      `${apiPath()}/disable?redirect=${encodeURIComponent(here())}`
    );
  }

  function toggle() {
    setShown((on) => !on);
  }

  // The Studio's address bar follows the page.
  createEffect(here, (url) => tell?.({ type: "push", url }), { defer: true });

  onSettled(() => {
    if (import.meta.env.SSR || !draftSession()) {
      return;
    }

    // Sanity's own test for Presentation: its iframe, or the preview window
    // the Studio opened.
    if (window.self !== window.top || window.opener) {
      setShown(true);
    } else {
      setOutside(true);
    }
  });

  createEffect(shown, (on) => {
    if (!on) {
      return;
    }

    let disable: (() => void) | undefined;
    let gone = false;

    async function enable() {
      const [{ enableVisualEditing }] = await Promise.all([
        import("@sanity/visual-editing-standalone"),
        import("@sanity/visual-editing-standalone/styles.css"),
      ]);

      if (gone) {
        return;
      }

      disable = enableVisualEditing({
        history: {
          subscribe(navigateStudio) {
            tell = navigateStudio;
            navigateStudio({ type: "replace", url: here() });

            return () => {
              tell = undefined;
            };
          },
          update(update) {
            if (update.type === "pop") {
              history.back();
            } else {
              navigate(update.url, { replace: update.type === "replace" });
            }
          },
        },
        refresh,
        onPerspectiveChange: (perspective) => {
          followPerspective(perspective);
        },
      });
    }

    enable();

    return () => {
      gone = true;
      disable?.();
    };
  });

  return (
    <Show when={outside()}>
      {props.exit(end)}
      {props.overlay(shown, toggle)}
    </Show>
  );
}
