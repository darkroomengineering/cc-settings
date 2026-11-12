import { staticKey } from "../ast.ts";
import type { AstNode, Rule } from "../types.ts";

const SCROLLS = new Set(["scrollTo", "scrollBy", "scroll"]);
const GLOBALS = new Set(["window", "globalThis", "self"]);
const PAGE_ELEMENTS = new Set(["documentElement", "scrollingElement"]);

export const noNativeScroll: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "The page scrolls through scrollTo() from @visio/scroll, not through the native scroll calls.",
    },
    messages: {
      page: "`{{call}}` moves the page past @visio/scroll, and fights Lenis's glide when <SmoothScroll /> runs. Scroll with `scrollTo(target)` from @visio/scroll; it takes a number, an `HTMLElement` or a selector, glides with or without Lenis, and jumps under reduced motion. Read .claude/skills/scroll/SKILL.md.",
      smooth:
        "`scrollIntoView({ behavior: 'smooth' })` ignores reduced motion, and fights Lenis's glide when <SmoothScroll /> runs. A jump without `behavior` is fine. To bring an element into view on the page, use `scrollTo(element)` from @visio/scroll. In a nested scroller (a carousel, a tab strip), call the scroller's own `scrollTo({ left, behavior: 'smooth' })`. Read .claude/skills/scroll/SKILL.md.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;

        if (callee.type !== "MemberExpression") {
          return;
        }

        const name = callee.computed
          ? staticKey(callee.property)
          : propertyName(callee.property);

        if (name && SCROLLS.has(name) && isPage(callee.object)) {
          const call = `${context.sourceCode.getText(callee.object)}.${name}()`;
          context.report({ node, messageId: "page", data: { call } });
        } else if (name === "scrollIntoView" && isSmooth(node.arguments[0])) {
          context.report({ node, messageId: "smooth" });
        }
      },
    };
  },
};

function propertyName(node: AstNode): string | undefined {
  return node.type === "Identifier" ? node.name : undefined;
}

function isPage(node: AstNode): boolean {
  if (node.type === "Identifier") {
    return GLOBALS.has(node.name);
  }

  if (node.type !== "MemberExpression" || node.computed) {
    return false;
  }

  const name = propertyName(node.property);

  if (!name || !PAGE_ELEMENTS.has(name)) {
    return false;
  }

  const owner = node.object;

  if (owner.type === "Identifier") {
    return owner.name === "document";
  }

  return (
    owner.type === "MemberExpression" &&
    !owner.computed &&
    propertyName(owner.property) === "document" &&
    owner.object.type === "Identifier" &&
    GLOBALS.has(owner.object.name)
  );
}

function isSmooth(node: AstNode | undefined): boolean {
  if (node?.type !== "ObjectExpression") {
    return false;
  }

  return node.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      staticKey(property.key) === "behavior" &&
      property.value.type === "Literal" &&
      property.value.value === "smooth"
  );
}
