import { isFunction, staticKey, walkBody } from "../ast.ts";
import type { Fn } from "../ast.ts";
import type { AstNode, NodeOf, Rule } from "../types.ts";

// Only a relative or alias path: a package named `routes` is not the table.
function isRoutesModule(specifier: string): boolean {
  return /^(?:\.{1,2}|~|@|#)(?:\/.+)?\/routes(?:\/index)?(?:\.[cm]?[jt]sx?)?$/u.test(
    specifier
  );
}

function nameOf(fn: Fn): string | undefined {
  const own = fn.id?.name;

  if (own) {
    return own;
  }

  const { parent } = fn;

  if (
    parent?.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
  ) {
    return parent.id.name;
  }

  if (parent?.type === "Property" && !parent.computed) {
    return staticKey(parent.key);
  }

  return undefined;
}

function isJsx(
  node: AstNode | null | undefined,
  reads: (node: AstNode) => boolean
): boolean {
  if (!node) {
    return false;
  }

  switch (node.type) {
    case "JSXElement":
    case "JSXFragment": {
      return true;
    }

    case "Literal": {
      return node.value === null;
    }

    case "ParenthesizedExpression": {
      return isJsx(node.expression, reads);
    }

    // tsc infers the type of a condition, and with it the falsy part of `&&`.
    case "ConditionalExpression": {
      return (
        !reads(node.test) &&
        isJsx(node.consequent, reads) &&
        isJsx(node.alternate, reads)
      );
    }

    case "LogicalExpression": {
      return (
        (node.operator === "&&"
          ? !reads(node.left)
          : isJsx(node.left, reads)) && isJsx(node.right, reads)
      );
    }

    default: {
      return false;
    }
  }
}

function returnsJsx(fn: Fn, reads: (node: AstNode) => boolean): boolean {
  if (!fn.body) {
    return false;
  }

  if (fn.body.type !== "BlockStatement") {
    return isJsx(fn.body, reads);
  }

  let returns = 0;
  let other = false;
  walkBody(fn.body, (node) => {
    if (node.type !== "ReturnStatement") {
      return;
    }

    returns += 1;

    if (!isJsx(node.argument, reads)) {
      other = true;
    }
  });

  return returns > 0 && !other;
}

function defaultExport(program: NodeOf<"Program">): AstNode | undefined {
  for (const statement of program.body) {
    if (statement.type !== "ExportDefaultDeclaration") {
      continue;
    }

    return statement.declaration;
  }

  return undefined;
}

export const metaReturnType: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A function in a page module that reads the route table declares its return type.",
    },
    messages: {
      meta: "Declare meta's return type: `meta: (): Meta => ({ ... })`, or `({ data }): Meta => ...`, with `import type { Meta } from '@visio/router'`. `{{name}}` comes from the route table, whose type reads this route, so an inferred return type is circular and tsc gives `any` (TS7022) to `route`, `routes` and `paths`. Read .claude/skills/router/SKILL.md, \"Head tags\".",
      returnType:
        'Declare the type that `{{fn}}` returns, such as `(): string` or `(): Meta`. It reads `{{name}}` from the route table, whose type reads this route, so an inferred return type is circular and tsc gives `any` (TS7022) to `route`, `routes` and `paths`. Read .claude/skills/router/SKILL.md, "Head tags".',
      topLevel:
        'Read `{{name}}` inside a function, such as `meta` or the component. src/routes.ts imports this page\'s `route`, so a read at the top of the module runs before the route table exists. Read .claude/skills/router/SKILL.md, "Head tags".',
    },
  },
  create(context) {
    const reported = new Set<AstNode>();
    let component: AstNode | undefined;
    let tableReads: { identifier: AstNode; name: string }[] = [];

    function reads(node: AstNode): boolean {
      return tableReads.some(({ identifier }) => {
        for (
          let at: AstNode | null | undefined = identifier;
          at;
          at = at.parent
        ) {
          if (at === node) {
            return true;
          }
        }

        return false;
      });
    }

    function isComponent(fn: Fn): boolean {
      if (component === fn) {
        return true;
      }

      return component?.type === "Identifier" && nameOf(fn) === component.name;
    }

    function check(identifier: AstNode, name: string): void {
      let outer: Fn | undefined;
      let inFunction = false;

      for (let node = identifier.parent; node; node = node.parent) {
        // `typeof paths` in a type is no read at runtime.
        if (node.type === "TSTypeQuery") {
          return;
        }

        if (!isFunction(node)) {
          continue;
        }

        inFunction = true;
        const fn = node;

        if (fn.returnType || isComponent(fn) || returnsJsx(fn, reads)) {
          return;
        }

        outer = fn;
      }

      if (!inFunction) {
        context.report({
          node: identifier,
          messageId: "topLevel",
          data: { name },
        });

        return;
      }

      if (!outer || reported.has(outer)) {
        return;
      }

      reported.add(outer);
      const fn = nameOf(outer);

      if (fn === "meta") {
        context.report({ node: outer, messageId: "meta", data: { name } });
      } else {
        context.report({
          node: outer,
          messageId: "returnType",
          data: { name, fn: fn ?? "this function" },
        });
      }
    }

    return {
      Program(program) {
        reported.clear();
        tableReads = [];
        component = defaultExport(program);
      },
      ImportDeclaration(node) {
        if (node.importKind === "type" || !isRoutesModule(node.source.value)) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind === "type"
          ) {
            continue;
          }

          for (const variable of context.sourceCode.getDeclaredVariables(
            specifier
          )) {
            for (const reference of variable.references) {
              tableReads.push({
                identifier: reference.identifier,
                name: variable.name,
              });
            }
          }
        }
      },
      "Program:exit"() {
        for (const { identifier, name } of tableReads) {
          check(identifier, name);
        }
      },
    };
  },
};
