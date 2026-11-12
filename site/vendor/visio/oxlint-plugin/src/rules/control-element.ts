import { findAttribute, intrinsicTag, stringValue } from "../ast.ts";
import type { NodeOf, Rule } from "../types.ts";

// The handlers that make an element something to press or drag.
const PRESS = new Set([
  "onClick",
  "onDblClick",
  "onAuxClick",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onTouchStart",
  "onTouchEnd",
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
]);

// jsx-a11y's no-static-element-interactions reads only the others.
const UNREAD = new Set([
  "onDblClick",
  "onAuxClick",
  "onPointerDown",
  "onPointerUp",
  "onTouchStart",
  "onTouchEnd",
]);

const INTERACTIVE = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "option",
  "summary",
  "details",
  "audio",
  "video",
]);

// A role that stands in for one of these tags; the tag brings focus, keys and the role.
const NATIVE = new Map([
  ["button", { tag: "button", use: '<button type="button">' }],
  ["link", { tag: "a", use: "<a href>" }],
]);

const SKILL = "Read .claude/skills/styling/SKILL.md.";

type Opening = NodeOf<"JSXOpeningElement">;

function literal(node: Opening, name: string): string | true | undefined {
  const attribute = findAttribute(node, name);

  if (!attribute) {
    return undefined;
  }

  const { value } = attribute;

  if (value === null) {
    return true;
  }

  if (value.type === "JSXExpressionContainer") {
    const { expression } = value;

    if (expression.type === "Literal" && expression.value === true) {
      return true;
    }

    return stringValue(expression);
  }

  return stringValue(value);
}

function firstRole(node: Opening): string {
  const role = literal(node, "role");

  return role === undefined || role === true
    ? ""
    : (role.trim().split(/\s+/u)[0] ?? "");
}

function hidden(node: Opening): string | undefined {
  const first = firstRole(node);

  if (first === "presentation" || first === "none") {
    return `role="${first}"`;
  }

  const ariaHidden = literal(node, "aria-hidden");

  return ariaHidden === true || ariaHidden === "true"
    ? "aria-hidden"
    : undefined;
}

function interactive(tag: string, node: Opening): boolean {
  if (tag === "a" || tag === "area") {
    return Boolean(findAttribute(node, "href"));
  }

  if (tag === "input") {
    return literal(node, "type") !== "hidden";
  }

  return INTERACTIVE.has(tag);
}

export const controlElement: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A handler that makes an element a control sits on a real control.",
    },
    messages: {
      hidden: `\`{{handler}}\` on an element with \`{{why}}\` makes a control that is outside the accessibility tree: no screen reader finds it. Use \`<button type="button">\`, or \`<a href>\` when it opens a page. ${SKILL}`,
      role: `\`role="{{role}}"\` on a \`<{{tag}}>\` leaves the focus and the keys to hand-written code; \`{{use}}\` has them built in. Use \`{{use}}\`. ${SKILL}`,
      static: `\`{{handler}}\` on a \`<{{tag}}>\` makes a control that takes no focus and has no role. Use \`<button type="button">\`, or \`<a href>\` when it opens a page. A drag surface gets the role of what it moves (\`role="slider"\`), \`tabindex="0"\` and a key handler. ${SKILL}`,
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tag = intrinsicTag(node);

        if (tag === undefined) {
          return;
        }

        const role = firstRole(node);
        const native = NATIVE.get(role);

        if (native && native.tag !== tag) {
          context.report({
            node,
            messageId: "role",
            data: { role, tag, use: native.use },
          });
        }

        const why = hidden(node);
        const bare = !findAttribute(node, "role") && !interactive(tag, node);

        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier"
          ) {
            continue;
          }

          const handler = attribute.name.name;

          if (why !== undefined && PRESS.has(handler)) {
            context.report({
              node: attribute,
              messageId: "hidden",
              data: { handler, why },
            });
          } else if (bare && UNREAD.has(handler)) {
            context.report({
              node: attribute,
              messageId: "static",
              data: { handler, tag },
            });
          }
        }
      },
    };
  },
};
