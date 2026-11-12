import { findAttribute, intrinsicTag } from "../ast.ts";
import type { Rule } from "../types.ts";

export const noRawImg: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Images render through <Image> from @visio/image-optimizer, never a raw <img>, <picture> or <source srcset>.",
    },
    messages: {
      raw: "A raw <{{tag}}> skips the build-time variants, the placeholder, `sizes` and the lazy load. Import the file with `?responsive` (an `.svg` too, then without `sizes`), pass `sanityImage(value)`, or for a URL the site does not own `remoteImage(url, { aspectRatio })`, and render `<Image>` from `@visio/image-optimizer`. Read .claude/skills/images/SKILL.md.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tag = intrinsicTag(node);

        if (
          tag === "img" ||
          tag === "picture" ||
          (tag === "source" && findAttribute(node, "srcset"))
        ) {
          context.report({ node, messageId: "raw", data: { tag } });
        }
      },
    };
  },
};
