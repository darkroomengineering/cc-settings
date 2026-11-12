import type { Rule } from "../types.ts";

export const serverOnlyMarker: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every module in src/server/ starts with `import 'server-only'`.",
    },
    messages: {
      missing:
        "A module in src/server/ needs `import 'server-only'` at the top: with it, a client import of this file fails the build and names the importer, before a secret or a Node API reaches the bundle. Read .claude/skills/solid-2/SKILL.md, \"Data and server functions\".",
    },
  },
  create(context) {
    return {
      Program(program) {
        const marked = program.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" &&
            statement.source.value === "server-only" &&
            statement.specifiers.length === 0
        );

        if (!marked) {
          context.report({ loc: { line: 1, column: 0 }, messageId: "missing" });
        }
      },
    };
  },
};
