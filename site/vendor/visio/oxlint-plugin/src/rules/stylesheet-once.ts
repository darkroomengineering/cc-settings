import { matchesGlob, projectPath } from "../paths.ts";
import type { Rule } from "../types.ts";

const STYLESHEET = "@visio/styling/css";

// Any app root: a linked project's own `src/app.tsx`, or one under `site/` or `apps/web/`.
const APP = "**/src/app.tsx";

export const stylesheetOnce: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "The compiled stylesheet is imported once, in src/app.tsx.",
    },
    messages: {
      elsewhere:
        "`import '@visio/styling/css'` belongs in src/app.tsx only: it is the whole site's stylesheet, and app.tsx already loads it. Remove this import; the `css()` calls of this file are in that stylesheet. Read .claude/skills/styling/SKILL.md.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== STYLESHEET) {
          return;
        }

        if (matchesGlob(projectPath(context), APP)) {
          return;
        }

        context.report({ node, messageId: "elsewhere" });
      },
    };
  },
};
