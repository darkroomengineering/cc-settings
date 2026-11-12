import { intrinsicTag } from "../ast.ts";
import type { NodeOf, Rule } from "../types.ts";

/** What an `<svg>` holds when CSS references its parts by `url(#id)`. */
const DEFS = new Set([
  "defs",
  "filter",
  "linearGradient",
  "radialGradient",
  "pattern",
  "mask",
  "clipPath",
  "marker",
]);

function holdsDefsOnly(node: NodeOf<"JSXElement">): boolean {
  let defs = 0;

  for (const child of node.children) {
    if (
      (child.type === "JSXText" && child.value.trim() === "") ||
      (child.type === "JSXExpressionContainer" &&
        child.expression.type === "JSXEmptyExpression")
    ) {
      continue;
    }

    const tag =
      child.type === "JSXElement"
        ? intrinsicTag(child.openingElement)
        : undefined;

    if (tag === undefined || !DEFS.has(tag)) {
      return false;
    }

    defs += 1;
  }

  return defs > 0;
}

export const noInlineSvg: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "SVG is imported as a component, never pasted into JSX.",
    },
    messages: {
      inline:
        "SVG markup in JSX is not optimized, and its ids can capture another SVG's gradients. Save it as a file and render `import Mark from './mark.svg?component'` (with `fill=\"currentColor\"` in the file, it takes the CSS color). Read .claude/skills/images/SKILL.md.",
      defs: "An SVG of defs alone in JSX is not optimized. Save it as a file and render `import Filters from './filters.svg?defs'` once, in the layout; its ids stay as written, so CSS references them with `url(#id)`. Read .claude/skills/images/SKILL.md.",
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        if (intrinsicTag(node.openingElement) === "svg") {
          context.report({
            node: node.openingElement,
            messageId: holdsDefsOnly(node) ? "defs" : "inline",
          });
        }
      },
    };
  },
};
