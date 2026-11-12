// oxlint exports its rule and AST types only through RuleTester's signature
// (the plugin API is alpha), so they are read off it here, in one place.
import type { RuleTester } from "oxlint/plugins-dev";

export type Rule = Parameters<RuleTester["run"]>[1];

export type Context = Parameters<
  Extract<Rule, { create: unknown }>["create"]
>[0];

export type AstNode = NonNullable<
  ReturnType<Context["sourceCode"]["getNodeByRangeIndex"]>
>;

export type NodeOf<T extends AstNode["type"]> = Extract<AstNode, { type: T }>;

export interface Plugin {
  meta: { name: string };
  rules: Record<string, Rule>;
}
