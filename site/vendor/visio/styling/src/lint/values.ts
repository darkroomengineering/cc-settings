import { transform } from "lightningcss";

import { isNumber } from "../guards.ts";

export interface ParsedValue {
  px?: number;
  rgb?: [number, number, number];
  /** Opacity of `rgb`, 0 to 1. */
  alpha?: number;
}

interface Walkable {
  [key: string]: unknown;
}

function isWalkable(v: unknown): v is Walkable {
  return typeof v === "object" && v !== null;
}

function find(value: unknown, out: ParsedValue) {
  if (!isWalkable(value)) {
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      find(v, out);
    }

    return;
  }

  const obj = value;

  if (out.px === undefined && obj.unit === "px" && isNumber(obj.value)) {
    out.px = obj.value;
  }

  if (
    out.rgb === undefined &&
    obj.type === "rgb" &&
    isNumber(obj.r) &&
    isNumber(obj.g) &&
    isNumber(obj.b)
  ) {
    out.rgb = [obj.r, obj.g, obj.b];
    out.alpha = isNumber(obj.alpha) ? obj.alpha : 1;
  }

  for (const key of Object.keys(obj)) {
    find(obj[key], out);
  }
}

export function parseValues(
  decls: { prop: string; value: string }[]
): ParsedValue[] {
  const results: ParsedValue[] = decls.map(() => ({}));

  if (!decls.length) {
    return results;
  }

  const css = decls
    .map((d, i) => `.d${i} { ${d.prop}: ${d.value}; }`)
    .join("\n");

  transform({
    filename: "report.css",
    code: Buffer.from(css),
    errorRecovery: true,
    visitor: {
      Rule(rule) {
        if (rule.type !== "style") {
          return;
        }

        const selector = rule.value.selectors[0]?.[0];

        if (!selector || selector.type !== "class") {
          return;
        }

        const index = Number(selector.name.slice(1));
        const target = results[index];

        if (!target) {
          return;
        }

        for (const decl of rule.value.declarations.declarations) {
          if (decl.property === "unparsed" || decl.property === "custom") {
            continue;
          }

          find(decl.value, target);
        }
      },
    },
  });

  return results;
}
