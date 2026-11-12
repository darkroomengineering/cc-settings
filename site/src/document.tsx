import { HydrationScript } from "@solidjs/web";
import type { ParentProps } from "solid-js";

import { t } from "./styles/tokens";

// The document shell. Every page sets its own title through its route's
// meta, so the one below is only a fallback. The router links the icons
// from src/icons/.
export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content={t.source.colors.page} />
        <title>cc-settings</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
