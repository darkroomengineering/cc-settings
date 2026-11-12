import { intrinsicTag, isRelative, staticKey } from "../ast.ts";
import type { AstNode, NodeOf, Rule } from "../types.ts";

export const stylePropVars: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "An element's `style` only sets custom properties declared with `cssVars()`.",
    },
    messages: {
      notObject:
        '`style` takes an object literal keyed by `cssVars()` names, `[v.progress.name]: progress()`. An `undefined` value leaves the var at its `initial`, so write `[v.x.name]: props.x`, not a conditional around the object. Static styles go in `css()`, states in a recipe or a class array. Read .claude/skills/styling/SKILL.md, "Runtime values".',
      key: '`{{key}}` is not a `cssVars()` property. Declare it, `const v = cssVars({ x: { syntax, initial } })`, reference `v.x` in `css()`, and set it here as `[v.x.name]`. Static styles go in `css()`. Read .claude/skills/styling/SKILL.md, "Runtime values".',
    },
  },
  create(context) {
    // Checked at the end: a `cssVars()` const may sit below the component.
    const vars = new Set<string>();
    const imported = new Set<string>();
    const styles: NodeOf<"JSXAttribute">[] = [];

    function isVar(name: string): boolean {
      return vars.has(name) || imported.has(name);
    }

    return {
      ImportDeclaration(node) {
        if (!isRelative(node.source.value)) {
          return;
        }

        for (const specifier of node.specifiers) {
          imported.add(specifier.local.name);
        }
      },
      VariableDeclarator(node) {
        const { init } = node;

        if (
          node.id.type === "Identifier" &&
          init?.type === "CallExpression" &&
          init.callee.type === "Identifier" &&
          init.callee.name === "cssVars"
        ) {
          vars.add(node.id.name);
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "style") {
          return;
        }

        const element = node.parent;

        if (element.type === "JSXOpeningElement" && intrinsicTag(element)) {
          styles.push(node);
        }
      },
      "Program:exit"() {
        for (const attribute of styles) {
          const { value } = attribute;

          const object =
            value?.type === "JSXExpressionContainer"
              ? value.expression
              : undefined;

          if (object?.type !== "ObjectExpression") {
            context.report({ node: attribute, messageId: "notObject" });
            continue;
          }

          for (const property of object.properties) {
            if (property.type !== "Property") {
              context.report({ node: property, messageId: "notObject" });
            } else if (!property.computed || !isVarName(property.key, isVar)) {
              const key =
                staticKey(property.key) ??
                context.sourceCode.getText(property.key);

              context.report({
                node: property.key,
                messageId: "key",
                data: { key },
              });
            }
          }
        }
      },
    };
  },
};

// `v.progress.name`, where `v` is a `cssVars()` result of this file or a relative import.
function isVarName(key: AstNode, isVar: (name: string) => boolean): boolean {
  if (key.type !== "MemberExpression" || key.computed) {
    return false;
  }

  if (key.property.type !== "Identifier" || key.property.name !== "name") {
    return false;
  }

  let root: AstNode = key.object;

  if (root.type !== "MemberExpression") {
    return false;
  }

  while (root.type === "MemberExpression") {
    root = root.object;
  }

  return root.type === "Identifier" && isVar(root.name);
}
