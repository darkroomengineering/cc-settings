import { css, dp } from "@visio/styling";

import { INCUBATOR } from "../lib/product";
import { paths } from "../routes";
import { t } from "../styles/tokens";

const s = css({
  footer: {
    borderBlockStartWidth: "1px",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: t.colors.rule,
  },
  row: {
    ...t.type.note,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: dp(24),
    maxInlineSize: t.layout.frame,
    marginInline: "auto",
    paddingBlock: dp(16),
    paddingInline: t.layout.safe,
    color: t.colors.dim,
  },
  links: {
    display: "flex",
    columnGap: dp(24),
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    minBlockSize: "44px",
    textDecorationLine: "underline",
    textUnderlineOffset: "0.2em",
    hover: { color: t.colors.ink },
    ":active": { color: t.colors.ink },
  },
});

export function Footer() {
  return (
    <footer class={s.footer}>
      <div class={s.row}>
        <nav class={s.links} aria-label="Footer">
          <a class={s.link} href={paths.privacy()}>
            Privacy
          </a>
          <a class={s.link} href={paths.support()}>
            Support
          </a>
        </nav>
        <a class={s.link} href={INCUBATOR}>
          A sidequest by Darkroom Engineering Incubator
        </a>
      </div>
    </footer>
  );
}
