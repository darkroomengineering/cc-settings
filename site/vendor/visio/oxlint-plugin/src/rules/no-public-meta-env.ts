import { staticKey } from "../ast.ts";
import type { AstNode, Rule } from "../types.ts";

/** `import.meta.env`, the object Vite fills. */
function isMetaEnv(node: AstNode): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "MetaProperty" &&
    node.object.meta.name === "import" &&
    node.object.property.name === "meta" &&
    staticKey(node.property) === "env"
  );
}

export const noPublicMetaEnv: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A `PUBLIC_` var is read from src/env.ts, never from `import.meta.env`.",
    },
    messages: {
      meta: "`import.meta.env.{{name}}` skips the validator in src/env.ts, and Vite fills it from the shell, not from the file of the mode. Import `env` from src/env.ts by a relative path and read `env.{{name}}`. Read .claude/skills/env/SKILL.md.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isMetaEnv(node.object)) {
          return;
        }

        const name = staticKey(node.property);

        if (name?.startsWith("PUBLIC_")) {
          context.report({ node, messageId: "meta", data: { name } });
        }
      },
    };
  },
};
