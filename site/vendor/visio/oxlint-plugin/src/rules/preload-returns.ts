import { importedBindings, isRelative, preloadOf, walkBody } from "../ast.ts";
import type { Fn } from "../ast.ts";
import type { AstNode, Context, Rule } from "../types.ts";

export const preloadReturns: Rule = {
  meta: {
    type: "problem",
    docs: { description: "A route's preload returns the queries it starts." },
    messages: {
      void: '`void` drops the promise: return it, `preload: () => getDoc(params.slug)`. The route table marks a returned promise handled, and `meta` and the page transition wait for it; a dropped one that rejects exits the dev server. Read .claude/skills/router/SKILL.md, "Routes and pages".',
      unreturned:
        '`{{name}}()` starts a read that the preload does not return. Return it (`return {{name}}(...)`, or `Promise.all([...])` for several): the route table marks a returned promise handled, and `meta` and the page transition wait for it. Read .claude/skills/router/SKILL.md, "Routes and pages".',
    },
  },
  create(context) {
    let imports = new Map<string, string>();
    let namespaces = new Set<string>();

    return {
      Program(program) {
        imports = importedBindings(program);
        namespaces = new Set();

        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration") {
            continue;
          }

          for (const specifier of statement.specifiers) {
            if (specifier.type === "ImportNamespaceSpecifier") {
              namespaces.add(specifier.local.name);
            }
          }
        }
      },
      CallExpression(node) {
        const fn = preloadOf(node);

        if (fn) {
          checkPreload(fn, imports, namespaces, context.report);
        }
      },
    };
  },
};

type Report = Context["report"];

function checkPreload(
  fn: Fn,
  imports: Map<string, string>,
  namespaces: Set<string>,
  report: Report
): void {
  const { body } = fn;

  if (!body) {
    return;
  }

  if (body.type !== "BlockStatement") {
    if (body.type === "UnaryExpression" && body.operator === "void") {
      report({ node: body, messageId: "void" });
    }

    return;
  }

  let returns = false;
  const statements: AstNode[] = [];
  walkBody(body, (node) => {
    if (
      node.type === "ReturnStatement" &&
      node.argument &&
      !isNothing(node.argument)
    ) {
      returns = true;
    }

    if (node.type === "ExpressionStatement") {
      statements.push(node);
    }
  });

  if (returns) {
    return;
  }

  for (const statement of statements) {
    if (statement.type !== "ExpressionStatement") {
      continue;
    }

    const call = unwrap(statement.expression);

    if (call?.type !== "CallExpression") {
      continue;
    }

    const name = queryName(call.callee, namespaces);

    if (!name) {
      continue;
    }

    const dot = name.indexOf(".");
    const source = imports.get(dot === -1 ? name : name.slice(0, dot));

    if (source !== undefined && isRelative(source)) {
      report({ node: call, messageId: "unreturned", data: { name } });
    }
  }
}

// `return null` on an early exit returns no read.
function isNothing(node: AstNode): boolean {
  return (
    (node.type === "Literal" && node.value === null) ||
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" && node.operator === "void")
  );
}

function queryName(
  callee: AstNode,
  namespaces: Set<string>
): string | undefined {
  if (callee.type === "Identifier") {
    return callee.name;
  }

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    namespaces.has(callee.object.name) &&
    callee.property.type === "Identifier"
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }

  return undefined;
}

function unwrap(node: AstNode): AstNode | undefined {
  if (node.type === "AwaitExpression") {
    return node.argument;
  }

  if (node.type === "UnaryExpression" && node.operator === "void") {
    return node.argument;
  }

  return node;
}
