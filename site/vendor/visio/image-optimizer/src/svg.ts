import { createHash } from "node:crypto";

import { optimize } from "svgo";
import type { PluginConfig, XastElement, XastRoot } from "svgo";

export interface SvgOptions {
  /** The file's path relative to the project, the seed of its id prefix. */
  path: string;
  /** SVGO plugins to run after the default preset and the built-in ones. */
  plugins?: PluginConfig[];
}

export interface OptimizedSvg {
  svg: string;
  /** The root `<svg>` element as SVGO left it. */
  root: XastElement;
  width: string | undefined;
  height: string | undefined;
  /** True when `width` and `height` came from the viewBox, not from the file. */
  sizedFromViewBox: boolean;
}

/** A short, stable token for a path: the id prefix inside that file. */
export function idPrefix(path: string): string {
  return `s${createHash("sha256").update(path).digest("hex").slice(0, 6)}`;
}

const VIEW_BOX_RE =
  /^\s*-?[\d.]+(?:e-?\d+)?[\s,]+-?[\d.]+(?:e-?\d+)?[\s,]+(?<width>[\d.]+(?:e-?\d+)?)[\s,]+(?<height>[\d.]+(?:e-?\d+)?)\s*$/v;

/** The width and height of a `viewBox`, when both are positive numbers. */
export function viewBoxSize(
  viewBox: string
): { width: number; height: number } | undefined {
  const size = VIEW_BOX_RE.exec(viewBox)?.groups;
  const width = Number(size?.width);
  const height = Number(size?.height);

  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** `width` and `height` from the `viewBox` when the root has neither. */
function sizeFromViewBox(into: { sized: boolean }): PluginConfig {
  return {
    name: "visio:sizeFromViewBox",
    fn: () => ({
      element: {
        enter(node, parent) {
          if (node.name !== "svg" || parent.type !== "root") {
            return;
          }

          const { width, height, viewBox } = node.attributes;

          if (
            width !== undefined ||
            height !== undefined ||
            viewBox === undefined
          ) {
            return;
          }

          const size = viewBoxSize(viewBox);

          if (!size) {
            return;
          }

          node.attributes.width = String(size.width);
          node.attributes.height = String(size.height);
          into.sized = true;
        },
      },
    }),
  };
}

/**
 * SVGO's attribute table lists only `xlink:href` on `<a>`, so the preset
 * removes SVG 2's `href` and the link with it. The first plugin runs before
 * the preset and saves it; the second puts it back.
 */
function keepLinkHref(): [PluginConfig, PluginConfig] {
  const hrefs = new Map<XastElement, string>();

  return [
    {
      name: "visio:saveLinkHref",
      fn: () => ({
        element: {
          enter(node) {
            const { href } = node.attributes;

            if (node.name === "a" && href !== undefined) {
              hrefs.set(node, href);
            }
          },
        },
      }),
    },
    {
      name: "visio:restoreLinkHref",
      fn: () => ({
        element: {
          enter(node) {
            const href = hrefs.get(node);

            if (href !== undefined) {
              node.attributes.href = href;
            }
          },
        },
      }),
    },
  ];
}

interface Captured {
  root?: XastRoot;
}

/** Captures the AST after every other plugin has run. */
function capture(into: Captured): PluginConfig {
  return {
    name: "visio:capture",
    fn: (root) => {
      into.root = root;

      return null;
    },
  };
}

function runSvgo(
  source: string,
  options: SvgOptions,
  preset: PluginConfig,
  after: PluginConfig[] = []
): Pick<OptimizedSvg, "svg" | "root"> {
  const captured: Captured = {};
  const [saveLinkHref, restoreLinkHref] = keepLinkHref();

  const result = optimize(source, {
    path: options.path,
    plugins: [
      saveLinkHref,
      preset,
      restoreLinkHref,
      ...after,
      ...(options.plugins ?? []),
      capture(captured),
    ],
  });

  const root = captured.root?.children.find(
    (n): n is XastElement => n.type === "element" && n.name === "svg"
  );

  if (!root) {
    throw new Error(
      `[@visio/image-optimizer] ${options.path} has no <svg> root.`
    );
  }

  return { svg: result.data, root };
}

export function optimizeSvg(source: string, options: SvgOptions): OptimizedSvg {
  const sizing = { sized: false };

  const { svg, root } = runSvgo(source, options, "preset-default", [
    {
      name: "prefixIds",
      params: { prefix: idPrefix(options.path), delim: "-" },
    },
    sizeFromViewBox(sizing),
  ]);

  return {
    svg,
    root,
    width: root.attributes.width,
    height: root.attributes.height,
    sizedFromViewBox: sizing.sized,
  };
}

export interface OptimizedDefs {
  root: XastElement;
  /** The ids in the file, in document order, as written. */
  ids: string[];
}

/**
 * A file of shared defs, for `?defs`: the ids stay as written, and nothing in
 * the file references them, so the plugins that drop unreferenced defs are off.
 */
export function optimizeDefs(
  source: string,
  options: SvgOptions
): OptimizedDefs {
  const { root } = runSvgo(source, options, {
    name: "preset-default",
    params: { overrides: { cleanupIds: false, removeHiddenElems: false } },
  });

  const ids: string[] = [];

  function walk(node: XastElement) {
    if (node.attributes.id !== undefined) {
      ids.push(node.attributes.id);
    }

    for (const child of node.children) {
      if (child.type === "element") {
        walk(child);
      }
    }
  }

  // The component replaces the root, so an id on it references nothing.
  for (const child of root.children) {
    if (child.type === "element") {
      walk(child);
    }
  }

  if (ids.length === 0) {
    throw new Error(
      `[@visio/image-optimizer] ${options.path}?defs has no element with an id, so nothing can reference it. Give each filter, gradient or pattern the id that CSS names in url(#id).`
    );
  }

  return { root, ids };
}

function jsxAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
    .join("");
}

/** Elements whose whitespace is text: the space between two `<tspan>`s is a word break. */
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "a"]);

function jsxChildren(parent: XastElement): string {
  let out = "";

  for (const child of parent.children) {
    switch (child.type) {
      case "element": {
        out += jsxElement(child);
        break;
      }

      case "text": {
        if (child.value.trim() !== "" || TEXT_ELEMENTS.has(parent.name)) {
          out += `{${JSON.stringify(child.value)}}`;
        }

        break;
      }

      case "cdata": {
        out += `{${JSON.stringify(child.value)}}`;
        break;
      }

      default: {
        break;
      }
    }
  }

  return out;
}

/**
 * Drops `xmlns` from an inline `<svg>`: the tag gives the namespace, and
 * through the spread it would be set again at runtime. The file keeps it.
 */
function inlineAttributes(node: XastElement): Record<string, string> {
  if (node.name !== "svg" || node.attributes.xmlns === undefined) {
    return node.attributes;
  }

  const { xmlns: _, ...rest } = node.attributes;

  return rest;
}

function jsxElement(node: XastElement, extra = ""): string {
  const attrs = jsxAttributes(inlineAttributes(node)) + extra;

  if (node.children.length === 0) {
    return `<${node.name}${attrs}/>`;
  }

  return `<${node.name}${attrs}>${jsxChildren(node)}</${node.name}>`;
}

/** One line of text tall, the width from the aspect ratio: `1em` by `1.069em`. */
function emSize(
  width: string,
  height: string
): { width: string; height: string } | null {
  const w = Number(width);
  const h = Number(height);

  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) {
    return null;
  }

  return { width: `${Math.round((w / h) * 1000) / 1000}em`, height: "1em" };
}

/**
 * File attributes first, props spread last, so call-site `class`, `width`
 * and `aria-label` win. A size the file did not author becomes 1em tall.
 */
export function svgComponent(svg: OptimizedSvg): string {
  let { root } = svg;

  if (
    svg.sizedFromViewBox &&
    svg.width !== undefined &&
    svg.height !== undefined
  ) {
    const em = emSize(svg.width, svg.height);

    if (em) {
      root = { ...root, attributes: { ...root.attributes, ...em } };
    }
  }

  return `export default (props) => ${jsxElement(root, " {...props}")};\n`;
}

const DEFS_ROOT = `<svg aria-hidden="true" width="0" height="0" style="position:absolute">`;

export function defsComponent(defs: OptimizedDefs): string {
  return `export default () => ${DEFS_ROOT}${jsxChildren(defs.root)}</svg>;\n`;
}
