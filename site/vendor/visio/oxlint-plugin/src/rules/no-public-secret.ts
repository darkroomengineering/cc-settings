import { staticKey } from "../ast.ts";
import type { Rule } from "../types.ts";

const SECRET = /TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY/iu;

export const noPublicSecret: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A secret is never declared in the `client` block of src/env.ts.",
    },
    messages: {
      public:
        "`{{name}}` looks like a secret, and a `client` var is baked into the public bundle. Move it to the `server` block and import `env` from src/env.ts in server code. Read .claude/skills/env/SKILL.md.",
    },
  },
  create(context) {
    return {
      Property(node) {
        if (node.computed || staticKey(node.key) !== "client") {
          return;
        }

        if (node.value.type !== "ObjectExpression") {
          return;
        }

        for (const property of node.value.properties) {
          if (property.type !== "Property") {
            continue;
          }

          const name = staticKey(property.key);

          if (name && SECRET.test(name)) {
            context.report({
              node: property.key,
              messageId: "public",
              data: { name },
            });
          }
        }
      },
    };
  },
};
