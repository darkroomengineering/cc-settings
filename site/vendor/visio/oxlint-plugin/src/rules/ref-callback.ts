import type { AstNode, Rule } from "../types.ts";

/** `a`, `a!`, `a as T`, `<T>a`, `a satisfies T`: the identifier under the casts. */
function bareIdentifier(node: AstNode): string | undefined {
  let current = node;

  while (
    current.type === "TSNonNullExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }

  return current.type === "Identifier" ? current.name : undefined;
}

export const refCallback: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "An element ref is a callback that assigns the variable.",
    },
    messages: {
      callback:
        "Write `ref={({{param}}) => ({{name}} = {{param}})}`: the callback is the one form of an element ref. On `ref={{{name}}}` oxlint reports the variable as always undefined, since it cannot see that Solid's compiler assigns it. Read .claude/skills/solid-2/SKILL.md.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "ref") {
          return;
        }

        if (node.value?.type !== "JSXExpressionContainer") {
          return;
        }

        const name = bareIdentifier(node.value.expression);

        if (!name) {
          return;
        }

        let scope: ReturnType<typeof context.sourceCode.getScope> | null =
          context.sourceCode.getScope(node);

        for (; scope; scope = scope.upper) {
          const variable = scope.set.get(name);

          if (!variable) {
            continue;
          }

          const assignable = variable.defs.some(
            (def) =>
              def.type === "Variable" &&
              def.parent?.type === "VariableDeclaration" &&
              def.parent.kind !== "const"
          );

          if (assignable) {
            const param = name === "el" ? "node" : "el";
            context.report({
              node,
              messageId: "callback",
              data: { name, param },
            });
          }

          return;
        }
      },
    };
  },
};
