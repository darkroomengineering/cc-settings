import type { Rule } from "../types.ts";

const DIRECTIVE =
  /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?=\s|$)(?<rest>[^]*)$/u;

export type DisableFinding =
  | { messageId: "bare" }
  | { messageId: "named"; rule: string };

export const DISABLE_MESSAGES = {
  named:
    "A comment may not turn off `{{rule}}`. Do the fix its message names. An escape that is a real decision goes in oxlint.config.ts, where a review sees it. Read node_modules/@visio/oxlint-plugin/DESIGN.md.",
  bare: "A disable comment without rule names also turns off the `visio/*` rules. Name the rules it is for (`oxlint-disable-next-line no-await-in-loop`). Read node_modules/@visio/oxlint-plugin/DESIGN.md.",
};

export function disableFindings(comment: string): DisableFinding[] {
  const match = DIRECTIVE.exec(comment);

  if (!match) {
    return [];
  }

  const rest = match.groups?.rest ?? "";
  const reason = rest.indexOf("--");
  const names = (reason === -1 ? rest : rest.slice(0, reason)).trim();

  if (names === "") {
    return [{ messageId: "bare" }];
  }

  return names
    .split(/[\s,]+/u)
    .filter((rule) => rule.startsWith("visio/"))
    .map((rule) => ({ messageId: "named", rule }));
}

export const noVisioDisable: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "No inline disable of a `visio/*` rule: no `oxlint-disable` or `eslint-disable` comment that names one, and no bare one that turns every rule off.",
    },
    messages: DISABLE_MESSAGES,
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const finding of disableFindings(comment.value)) {
            context.report(
              finding.messageId === "named"
                ? {
                    loc: comment.loc,
                    messageId: "named",
                    data: { rule: finding.rule },
                  }
                : { loc: comment.loc, messageId: "bare" }
            );
          }
        }
      },
    };
  },
};
