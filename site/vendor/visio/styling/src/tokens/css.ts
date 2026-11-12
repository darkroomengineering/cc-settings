import { unicodeRangeOf } from "../fonts/index.ts";
import type { WeightFallback } from "../fonts/index.ts";
import { columnCss, tokenVarName, dp } from "../helpers.ts";
import { faces, onScreen, resolveResponsive, screenStops } from "./index.ts";
import type { ScreenStop } from "./index.ts";
import type { TokenSource } from "./types.ts";

export interface TokensCssOptions {
  /** Variable names (`--colors-ink`) that are referenced somewhere. Omit to keep everything. */
  used?: Set<string>;
  /** Shipped URL per font key and file, in the order of `FontLeaf.urls`. Files without one use their `src`. */
  fontUrls?: Record<string, string[]>;
  /** Resolved `unicode-range` per font key and file, for `subset: 'used'`. */
  fontRanges?: Record<string, (string | undefined)[]>;
  /** Metric-matched local fallback per font key. */
  fallbacks?: Record<string, readonly WeightFallback[]>;
}

export interface TokensCssResult {
  css: string;
  /** Variable names that were declared but left out. */
  pruned: string[];
}

function property(
  name: string,
  syntax: string,
  initial: string,
  inherits = true
) {
  return `@property ${name} { syntax: "${syntax}"; inherits: ${inherits}; initial-value: ${initial}; }`;
}

function quote(family: string) {
  return /\s/v.test(family) ? `"${family}"` : family;
}

/** The `font-family` list: the font, its metric-matched fallback face, then the authored fallback. */
function fontStack(
  family: string,
  fallback?: string,
  matched?: readonly WeightFallback[]
) {
  const parts = [quote(family)];

  if (matched?.length) {
    parts.push(`"${fallbackFamily(family)}"`);
  }

  if (fallback) {
    parts.push(fallback);
  }

  return parts.join(", ");
}

/** Name of the generated face that draws the local fallback in the web font's metrics. */
function fallbackFamily(family: string) {
  return `${family} Fallback`;
}

export function tokensToCss(
  source: TokenSource,
  opts: TokensCssOptions = {}
): TokensCssResult {
  const { layout } = source;
  const stops = screenStops(source);
  const [mobile, ...rest] = stops;

  if (!mobile) {
    throw new Error("[@visio/styling] screenStops() returned no screens.");
  }

  const gap = resolveResponsive(layout.gap, stops);
  const safe = resolveResponsive(layout.safe, stops);
  const columns = resolveResponsive(layout.columns, stops);
  const fluid = source.fluid ?? true;
  const pruned: string[] = [];

  // Fixed is in rem, so the browser's text size setting still scales the page.
  // It is set once, at the root.
  function unit(s: ScreenStop) {
    if (!fluid) {
      return s.from === undefined
        ? ["--dp: calc(1rem / 16);", "--dph: calc(1rem / 16);"]
        : [];
    }

    return [
      `--dp: calc(var(--frame) / ${s.width});`,
      `--dph: calc(100vh / ${s.height});`,
    ];
  }

  function keep(name: string) {
    if (!opts.used || opts.used.has(name)) {
      return true;
    }

    pruned.push(name);

    return false;
  }

  const sizes = Object.entries(source.sizes ?? {})
    .filter(([k]) => keep(tokenVarName("sizes", k)))
    .map(([k, v]) => [k, resolveResponsive(v, stops)] as const);

  const colors = Object.entries(source.colors).filter(([k]) =>
    keep(tokenVarName("colors", k))
  );

  const easings = Object.entries(source.easings ?? {}).filter(([k]) =>
    keep(tokenVarName("easings", k))
  );

  const fonts = Object.entries(source.fonts ?? {}).filter(([k]) =>
    keep(tokenVarName("fonts", k))
  );

  const keptColors = new Set(colors.map(([k]) => k));

  const registrations = [
    property("--frame", "<length>", "0px"),
    property("--dp", "<length>", "0px"),
    property("--dph", "<length>", "0px"),
    property("--gap", "<length>", "0px"),
    property("--safe", "<length>", "0px"),
    property("--col", "<length>", "0px"),
    property("--columns", "<integer>", "1"),
    ...sizes.map(([k]) =>
      property(tokenVarName("sizes", k), "<length>", "0px")
    ),
  ];

  const root: string[] = [
    `--frame: ${layout.maxWidth ? `min(100vw, ${layout.maxWidth}px)` : "100vw"};`,
    ...unit(mobile),
    `--gap: ${dp(onScreen(gap, mobile.name))};`,
    `--safe: ${dp(onScreen(safe, mobile.name))};`,
    `--col: ${columnCss(onScreen(columns, mobile.name))};`,
    `--columns: ${onScreen(columns, mobile.name)};`,
    ...sizes.map(
      ([k, v]) =>
        `${tokenVarName("sizes", k)}: ${dp(onScreen(v, mobile.name))};`
    ),
    ...colors.map(([k, v]) => `${tokenVarName("colors", k)}: ${v};`),
    ...easings.map(([k, v]) => `${tokenVarName("easings", k)}: ${v};`),
    ...fonts.map(
      ([k, f]) =>
        `${tokenVarName("fonts", k)}: ${fontStack(f.family, f.fallback, opts.fallbacks?.[k])};`
    ),
  ];

  // One block per screen past mobile, narrowest first, so each takes over
  // from the one before it at its own start.
  const overrides = rest.map((s) => {
    const lines = [
      ...unit(s),
      `--gap: ${dp(onScreen(gap, s.name))};`,
      `--safe: ${dp(onScreen(safe, s.name))};`,
      `--col: ${columnCss(onScreen(columns, s.name))};`,
      `--columns: ${onScreen(columns, s.name)};`,
      ...sizes.map(
        ([k, v]) => `${tokenVarName("sizes", k)}: ${dp(onScreen(v, s.name))};`
      ),
    ];

    return `@media (width >= ${s.from}px) {\n  :root {\n    ${lines.join("\n    ")}\n  }\n}`;
  });

  // Every theme sets each colour any theme sets, and `light` sets the base
  // values: a theme inside another (a pinned page, a dark block) then shows
  // its own palette, not the outer theme's colours it leaves out.
  const palettes = Object.entries(source.themes ?? {});

  const themed = [
    ...new Set(palettes.flatMap(([, palette]) => Object.keys(palette))),
  ].filter((k) => keptColors.has(k));

  const themes = themed.length
    ? [["light", {}] as const, ...palettes].map(([name, palette]) => {
        const values: Record<string, string | undefined> = palette;

        const lines = themed.map(
          (k) =>
            `  ${tokenVarName("colors", k)}: ${values[k] ?? source.colors[k]};`
        );

        return `[data-theme=${name}] {\n${lines.join("\n")}\n}`;
      })
    : [];

  const fontFaces = fonts.flatMap(([k, f]) =>
    (f.sources ?? [])
      .flatMap((s) => faces(s).map((subset) => [s, subset] as const))
      .map(([s, subset], i) => {
        const url = opts.fontUrls?.[k]?.[i] ?? s.src;

        const range =
          opts.fontRanges?.[k]?.[i] ??
          (subset && subset !== "used" ? unicodeRangeOf(subset) : undefined);

        const lines = [
          `font-family: "${f.family}";`,
          subset
            ? `src: url("${url}") format("woff2");`
            : `src: url("${url}");`,
          ...(range ? [`unicode-range: ${range};`] : []),
          `font-weight: ${s.weight ?? 400};`,
          `font-style: ${s.style ?? "normal"};`,
          `font-display: ${s.display ?? "swap"};`,
        ];

        return `@font-face {\n  ${lines.join("\n  ")}\n}`;
      })
  );

  // A local face scaled to the web font's metrics, listed right after it, so
  // the swap keeps every line where it was.
  const fallbackFaces = fonts.flatMap(([k, f]) =>
    (opts.fallbacks?.[k] ?? []).map(({ weight, face }) => {
      const lines = [
        `font-family: "${fallbackFamily(f.family)}";`,
        `src: ${face.local.map((n) => `local("${n}")`).join(", ")};`,
        ...(weight === undefined ? [] : [`font-weight: ${weight};`]),
        `size-adjust: ${face.sizeAdjust};`,
        `ascent-override: ${face.ascentOverride};`,
        `descent-override: ${face.descentOverride};`,
        `line-gap-override: ${face.lineGapOverride};`,
      ];

      return `@font-face {\n  ${lines.join("\n  ")}\n}`;
    })
  );

  const body = `:root {\n  ${root.join("\n  ")}\n}\n${overrides.join("\n")}\n${themes.join("\n")}`;

  const css = [
    registrations.join("\n"),
    `@layer tokens {\n${body}\n}`,
    fontFaces.join("\n"),
    fallbackFaces.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  return { css, pruned };
}
