import { css, dp } from "@visio/styling";
import type { ParentProps } from "solid-js";

import { NAME } from "../lib/product";
import { paths } from "../routes";
import { t } from "../styles/tokens";

const s = css({
  page: {
    maxInlineSize: t.layout.frame,
    marginInline: "auto",
    paddingBlockStart: dp(20),
    paddingBlockEnd: dp(72),
    paddingInline: t.layout.safe,
  },
  home: {
    ...t.type.button,
    display: "inline-flex",
    alignItems: "center",
    minBlockSize: "44px",
    hover: { color: t.colors.accent },
    ":active": { color: t.colors.accent },
  },
  article: {
    display: "grid",
    rowGap: dp(20),
    maxInlineSize: t.sizes.measure,
    marginBlockStart: dp(40),
    desktop: { marginBlockStart: dp(72) },
  },
  heading: {
    ...t.type.title,
    marginBlockEnd: dp(8),
  },
});

// A page of running text: the privacy policy, support, and not found.
export function Prose(props: ParentProps<{ title: string }>) {
  return (
    <div class={s.page}>
      <a class={s.home} href={paths()}>
        {NAME}
      </a>
      <article class={s.article}>
        <h1 class={s.heading}>{props.title}</h1>
        {props.children}
      </article>
    </div>
  );
}
