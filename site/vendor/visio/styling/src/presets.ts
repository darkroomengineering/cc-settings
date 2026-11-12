import type { Style } from "./index.ts";

/** Hidden from sight, still read by screen readers. Spread it into a block. */
export const SR_ONLY = {
  position: "absolute",
  inlineSize: "1px",
  blockSize: "1px",
  marginBlockStart: "-1px",
  marginInlineStart: "-1px",
  paddingBlockStart: "0",
  paddingBlockEnd: "0",
  paddingInlineStart: "0",
  paddingInlineEnd: "0",
  borderWidth: "0",
  overflow: "clip",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
} as const satisfies Style;

/** How far each side of the hit area reaches past a box smaller than 44px. */
export const HIT_AREA_INSET = "min(0px, (100% - 44px) / 2)";

/** A pointer target of at least 44 by 44px around the box, on a pseudo-element, so the layout stays. */
export const HIT_AREA = {
  position: "relative",
  "::before": {
    content: '""',
    position: "absolute",
    insetBlockStart: HIT_AREA_INSET,
    insetBlockEnd: HIT_AREA_INSET,
    insetInlineStart: HIT_AREA_INSET,
    insetInlineEnd: HIT_AREA_INSET,
  },
} as const satisfies Style;

/** The layout grid: one track per column of the screen, the gap between. Its box is the content width, the frame less `safe` on each side. */
export const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(var(--columns), minmax(0, 1fr))",
  columnGap: "var(--gap)",
} as const satisfies Style;
