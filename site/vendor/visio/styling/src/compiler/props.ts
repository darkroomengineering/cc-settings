import { kebab } from "../helpers.ts";

/**
 * Properties whose numeric values are unitless by definition. The list is a
 * const so `CSSProperties` allows a bare number on exactly these.
 */
export const UNITLESS_PROPS = [
  "opacity",
  "z-index",
  "line-height",
  "font-weight",
  "flex",
  "flex-grow",
  "flex-shrink",
  "order",
  "zoom",
  "scale",
  "aspect-ratio",
  "column-count",
  "grid-row",
  "grid-column",
  "grid-row-start",
  "grid-row-end",
  "grid-column-start",
  "grid-column-end",
  "tab-size",
  "orphans",
  "widows",
  "animation-iteration-count",
  "font-size-adjust",
  "stroke-width",
  "fill-opacity",
  "stroke-opacity",
  "shape-image-threshold",
] as const;

export const UNITLESS: ReadonlySet<string> = new Set(UNITLESS_PROPS);

/**
 * Single-value shorthands and the longhands they expand to. Keeping only
 * longhands in the sheet makes atomic dedupe exact and merge order irrelevant.
 */
export const SHORTHANDS = new Map(
  Object.entries({
    padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    "padding-inline": ["padding-inline-start", "padding-inline-end"],
    "padding-block": ["padding-block-start", "padding-block-end"],
    margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
    "margin-inline": ["margin-inline-start", "margin-inline-end"],
    "margin-block": ["margin-block-start", "margin-block-end"],
    inset: ["top", "right", "bottom", "left"],
    "inset-inline": ["inset-inline-start", "inset-inline-end"],
    "inset-block": ["inset-block-start", "inset-block-end"],
    gap: ["row-gap", "column-gap"],
    "border-radius": [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ],
    "border-width": [
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
    ],
    "border-color": [
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
    ],
    "border-style": [
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style",
    ],
    overflow: ["overflow-x", "overflow-y"],
    "overscroll-behavior": ["overscroll-behavior-x", "overscroll-behavior-y"],
    "place-items": ["align-items", "justify-items"],
    "place-content": ["align-content", "justify-content"],
    "place-self": ["align-self", "justify-self"],
  })
);

/**
 * Box-edge properties with both a physical and a logical spelling. Each family
 * maps a physical longhand to the logical one that writes the same edge in a
 * horizontal writing mode; mixing the two in one style leaves the cascade to
 * decide by stylesheet order.
 */
const EDGE_TABLE = {
  margin: {
    "margin-top": "margin-block-start",
    "margin-bottom": "margin-block-end",
    "margin-left": "margin-inline-start",
    "margin-right": "margin-inline-end",
  },
  padding: {
    "padding-top": "padding-block-start",
    "padding-bottom": "padding-block-end",
    "padding-left": "padding-inline-start",
    "padding-right": "padding-inline-end",
  },
  inset: {
    top: "inset-block-start",
    bottom: "inset-block-end",
    left: "inset-inline-start",
    right: "inset-inline-end",
  },
  "border-width": {
    "border-top-width": "border-block-start-width",
    "border-bottom-width": "border-block-end-width",
    "border-left-width": "border-inline-start-width",
    "border-right-width": "border-inline-end-width",
  },
  "border-style": {
    "border-top-style": "border-block-start-style",
    "border-bottom-style": "border-block-end-style",
    "border-left-style": "border-inline-start-style",
    "border-right-style": "border-inline-end-style",
  },
  "border-color": {
    "border-top-color": "border-block-start-color",
    "border-bottom-color": "border-block-end-color",
    "border-left-color": "border-inline-start-color",
    "border-right-color": "border-inline-end-color",
  },
};

export const EDGE_FAMILIES = new Map(
  Object.entries(EDGE_TABLE).map(([family, pairs]) => [
    family,
    new Map(Object.entries(pairs)),
  ])
);

/**
 * Multi-value shorthands we refuse outright, with the spelling to use instead.
 * They hide several declarations in one string and defeat atomic dedupe.
 * `CSSProperties` reads the const to give each key a type no value fits.
 */
export const REJECTED = {
  border: "borderWidth, borderStyle, borderColor",
  "border-top": "borderTopWidth, borderTopStyle, borderTopColor",
  "border-right": "borderRightWidth, borderRightStyle, borderRightColor",
  "border-bottom": "borderBottomWidth, borderBottomStyle, borderBottomColor",
  "border-left": "borderLeftWidth, borderLeftStyle, borderLeftColor",
  outline: "outlineWidth, outlineStyle, outlineColor",
  font: "a type preset, or fontFamily, fontSize, lineHeight, fontWeight",
  background:
    "backgroundColor, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat",
  transition:
    "transitionProperty, transitionDuration, transitionTimingFunction, transitionDelay",
  animation:
    "animationName, animationDuration, animationTimingFunction, animationIterationCount",
  "list-style": "listStyleType, listStylePosition",
  "text-decoration":
    "textDecorationLine, textDecorationColor, textDecorationThickness",
  columns: "columnCount, columnWidth",
  "grid-area":
    "gridRowStart and gridColumnStart, which alone place a child in one cell (1 and 1 stack children on each other), and gridRowEnd, gridColumnEnd for a span",
  "grid-template": "gridTemplateRows, gridTemplateColumns",
  "flex-flow": "flexDirection, flexWrap",
  mask: "maskImage, maskSize, maskPosition, maskRepeat",
} as const;

export const REJECTED_SHORTHANDS = new Map<string, string>(
  Object.entries(REJECTED)
);

/** Properties whose change forces layout. Animating or transitioning them is a build error, except `display` with `allow-discrete` (`DISCRETE_PROPS`). */
export const LAYOUT_PROPS = new Set([
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "inline-size",
  "block-size",
  "min-inline-size",
  "max-inline-size",
  "min-block-size",
  "max-block-size",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-inline",
  "inset-block",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block-start",
  "inset-block-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-inline",
  "margin-block",
  "margin-inline-start",
  "margin-inline-end",
  "margin-block-start",
  "margin-block-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-inline",
  "padding-block",
  "padding-inline-start",
  "padding-inline-end",
  "padding-block-start",
  "padding-block-end",
  "display",
  "position",
  "float",
  "clear",
  "overflow",
  "overflow-x",
  "overflow-y",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "white-space",
  "text-align",
  "vertical-align",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-inline-width",
  "border-block-width",
  "border-inline-start-width",
  "border-inline-end-width",
  "border-block-start-width",
  "border-block-end-width",
  "flex",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "order",
  "align-items",
  "justify-content",
]);

export const DISCRETE_PROPS = new Set(["display"]);

/** Metric properties that only a type preset sets. */
export const TYPE_METRIC_PROPS = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
]);

/** Short names for readable atom classes. Anything not listed uses the full property name. */
export const ABBREVIATIONS = new Map(
  Object.entries({
    width: "w",
    height: "h",
    "min-width": "minw",
    "min-height": "minh",
    "max-width": "maxw",
    "max-height": "maxh",
    "padding-top": "pt",
    "padding-right": "pr",
    "padding-bottom": "pb",
    "padding-left": "pl",
    "padding-inline-start": "pis",
    "padding-inline-end": "pie",
    "padding-block-start": "pbs",
    "padding-block-end": "pbe",
    "margin-top": "mt",
    "margin-right": "mr",
    "margin-bottom": "mb",
    "margin-left": "ml",
    "margin-inline-start": "mis",
    "margin-inline-end": "mie",
    "margin-block-start": "mbs",
    "margin-block-end": "mbe",
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
    "row-gap": "rg",
    "column-gap": "cg",
    display: "d",
    position: "pos",
    "flex-direction": "fd",
    "align-items": "ai",
    "justify-content": "jc",
    "font-size": "fs",
    "font-family": "ff",
    "font-weight": "fw",
    "line-height": "lh",
    "letter-spacing": "ls",
    "text-transform": "tt",
    "text-align": "ta",
    color: "c",
    "background-color": "bg",
    "border-top-left-radius": "rtl",
    "border-top-right-radius": "rtr",
    "border-bottom-right-radius": "rbr",
    "border-bottom-left-radius": "rbl",
    opacity: "o",
    transform: "tf",
    transition: "tr",
    "transition-property": "trp",
    "transition-duration": "trd",
    "transition-timing-function": "trt",
    "z-index": "z",
    overflow: "ov",
    "overflow-x": "ovx",
    "overflow-y": "ovy",
    "pointer-events": "pe",
    "grid-template-columns": "gtc",
    "grid-column": "gc",
    "grid-row": "gr",
    "aspect-ratio": "ar",
    "object-fit": "of",
    "will-change": "wc",
    cursor: "cur",
  })
);

export function toKebab(prop: string): string {
  if (prop.startsWith("--")) {
    return prop;
  }

  return kebab(prop).replace(/^(?<vendor>webkit|moz|ms)-/v, "-$<vendor>-");
}
