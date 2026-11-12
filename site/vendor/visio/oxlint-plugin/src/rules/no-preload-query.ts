import { preloadOf, staticKey, walkBody } from "../ast.ts";
import type { AstNode, Rule } from "../types.ts";

export const noPreloadQuery: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "A preload reads the search string, not `location.query`.",
    },
    messages: {
      query:
        "`location.query` can give the query of the page the navigation leaves, in the router's first preload call, the one the navigation waits for. Read the search string: `new URLSearchParams(location.search).has('chain')`. Read .claude/skills/router/SKILL.md, \"Routes and pages\".",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const fn = preloadOf(node);

        if (!fn?.body) {
          return;
        }

        for (const param of fn.params) {
          walkBody(param, (child) => {
            if (isQueryPattern(child)) {
              context.report({ node: child, messageId: "query" });
            }
          });
        }

        walkBody(fn.body, (child) => {
          if (isQueryRead(child) || isQueryPattern(child)) {
            context.report({ node: child, messageId: "query" });
          }
        });
      },
    };
  },
};

function isLocation(node: AstNode): boolean {
  return (
    (node.type === "Identifier" && node.name === "location") ||
    (node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier" &&
      node.property.name === "location")
  );
}

/** `location.query` or `x.location.query`. */
function isQueryRead(node: AstNode): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "query" &&
    isLocation(node.object)
  );
}

/** `{ location: { query } }` in the parameters, or `const { query } = location`. */
function isQueryPattern(node: AstNode): boolean {
  if (node.type === "VariableDeclarator") {
    return (
      node.id.type === "ObjectPattern" &&
      node.init !== null &&
      isLocation(node.init) &&
      hasQueryKey(node.id)
    );
  }

  return (
    node.type === "Property" &&
    staticKey(node.key) === "location" &&
    node.value.type === "ObjectPattern" &&
    hasQueryKey(node.value)
  );
}

function hasQueryKey(pattern: Extract<AstNode, { type: "ObjectPattern" }>) {
  return pattern.properties.some(
    (property) =>
      property.type === "Property" && staticKey(property.key) === "query"
  );
}
