import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";
import type {
  ArrowFunctionExpression,
  ExportNamedDeclaration,
  Expression,
  Function as FunctionNode,
  ModuleExportName,
  VariableDeclaration,
} from "oxc-parser";

import { TRANSLATIONS } from "../translations.ts";
import { EvaluationError } from "./evaluation-error.ts";

export interface FoundQuery {
  /** The variable, which names the result type. */
  name: string;
  query: string;
}

export interface QueryModule {
  queries: FoundQuery[];
  errors: string[];
  /** The files its queries were built from, so a change there refinds this file. */
  deps: string[];
}

const QUERY_MODULE = "@visio/sanity";

/** The package's own constants a query may use, read from its module. */
const PACKAGE_STRINGS: ReadonlyMap<string, string> = new Map([
  ["TRANSLATIONS", TRANSLATIONS],
]);

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

interface Parsed {
  consts: Map<string, Expression>;
  /** Local name to the imported name and the resolved file. */
  imports: Map<
    string,
    { name: string; file: string | undefined; source: string }
  >;
  /** Exported name to local name, or to a re-export. */
  exports: Map<
    string,
    { local: string } | { name: string; file: string | undefined }
  >;
  /** The files of `export * from`, relative ones only. */
  starExports: string[];
  defineQuery: Set<string>;
  declarations: { name: string; init: Expression }[];
  /** Functions of the file whose body is one expression, by name. */
  functions: Map<string, Fragment>;
}

/** A function that returns a string built from its parameters: `t('title')`. */
interface Fragment {
  params: string[];
  body: Expression;
}

interface FragmentAt {
  file: string;
  fragment: Fragment;
}

const NO_SCOPE: ReadonlyMap<string, string> = new Map();

function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const base = path.resolve(path.dirname(from), specifier);
  // `./x.js` in TS source names `./x.ts`.
  const stem = base.replace(/\.[mc]?jsx?$/v, "");

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => stem + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];

  return candidates.find((file) =>
    statSync(file, { throwIfNoEntry: false })?.isFile()
  );
}

function unwrap(node: Expression): Expression {
  let current = node;

  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }

  return current;
}

/** `export { a as "b" }` names an export with a string. */
function nameOf(node: ModuleExportName) {
  return node.type === "Literal" ? node.value : node.name;
}

/** The function's parameters and its one returned expression, or undefined for any other function. */
function fragmentOf(
  node: ArrowFunctionExpression | FunctionNode
): Fragment | undefined {
  const params: string[] = [];

  if (node.async || node.generator) {
    return undefined;
  }

  for (const param of node.params) {
    if (param.type !== "Identifier") {
      return undefined;
    }

    params.push(param.name);
  }

  const { body } = node;

  if (!body) {
    return undefined;
  }

  if (body.type !== "BlockStatement") {
    return { params, body };
  }

  const [only, ...rest] = body.body;

  return only?.type === "ReturnStatement" && only.argument && rest.length === 0
    ? { params, body: only.argument }
    : undefined;
}

function parse(file: string, source: string): Parsed {
  const { program } = parseSync(file, source);

  const parsed: Parsed = {
    consts: new Map(),
    imports: new Map(),
    exports: new Map(),
    starExports: [],
    defineQuery: new Set(),
    declarations: [],
    functions: new Map(),
  };

  function addConsts(declaration: VariableDeclaration) {
    if (declaration.kind !== "const") {
      return;
    }

    for (const { id, init } of declaration.declarations) {
      if (id.type === "Identifier" && init) {
        parsed.consts.set(id.name, init);
        parsed.declarations.push({ name: id.name, init });
        const fn = unwrap(init);

        if (
          fn.type === "ArrowFunctionExpression" ||
          fn.type === "FunctionExpression"
        ) {
          const fragment = fragmentOf(fn);

          if (fragment) {
            parsed.functions.set(id.name, fragment);
          }
        }
      }
    }
  }

  function addFunction(node: FunctionNode) {
    const fragment = node.id && fragmentOf(node);

    if (node.id && fragment) {
      parsed.functions.set(node.id.name, fragment);
    }
  }

  function addExport(statement: ExportNamedDeclaration) {
    const { declaration, source: from } = statement;

    if (declaration?.type === "FunctionDeclaration") {
      addFunction(declaration);

      if (declaration.id) {
        parsed.exports.set(declaration.id.name, {
          local: declaration.id.name,
        });
      }
    }

    if (declaration?.type === "VariableDeclaration") {
      addConsts(declaration);

      for (const { id } of declaration.declarations) {
        if (id.type === "Identifier") {
          parsed.exports.set(id.name, { local: id.name });
        }
      }
    }

    for (const specifier of statement.specifiers) {
      const local = nameOf(specifier.local);
      parsed.exports.set(
        nameOf(specifier.exported),
        from
          ? { name: local, file: resolveRelative(file, from.value) }
          : { local }
      );
    }
  }

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      const from = statement.source.value;

      for (const specifier of statement.specifiers) {
        if (specifier.type !== "ImportSpecifier") {
          continue;
        }

        const imported = nameOf(specifier.imported);
        const local = specifier.local.name;

        if (from === QUERY_MODULE && imported === "defineQuery") {
          parsed.defineQuery.add(local);
        }

        parsed.imports.set(local, {
          name: imported,
          file: resolveRelative(file, from),
          source: from,
        });
      }
    } else if (statement.type === "VariableDeclaration") {
      addConsts(statement);
    } else if (statement.type === "FunctionDeclaration") {
      addFunction(statement);
    } else if (
      statement.type === "ExportAllDeclaration" &&
      !statement.exported
    ) {
      const star = resolveRelative(file, statement.source.value);

      if (star) {
        parsed.starExports.push(star);
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      addExport(statement);
    }
  }

  return parsed;
}

/** Caches each parsed file: a query built from several imports parses each once. */
class Evaluator {
  private cache = new Map<string, Parsed>();
  deps = new Set<string>();

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  load(file: string, source?: string): Parsed {
    let parsed = this.cache.get(file);

    if (!parsed) {
      parsed = parse(file, source ?? readFileSync(file, "utf-8"));
      this.cache.set(file, parsed);
    }

    return parsed;
  }

  string(
    file: string,
    node: Expression,
    seen: Set<string>,
    scope: ReadonlyMap<string, string> = NO_SCOPE
  ): string {
    const n = unwrap(node);

    if (n.type === "Literal" && typeof n.value === "string") {
      return n.value;
    }

    if (n.type === "TemplateLiteral") {
      let out = "";

      for (const [i, quasi] of n.quasis.entries()) {
        out += quasi.value.cooked ?? quasi.value.raw;
        const expression = n.expressions[i];

        if (expression) {
          out += this.string(file, expression, seen, scope);
        }
      }

      return out;
    }

    if (n.type === "BinaryExpression" && n.operator === "+") {
      return (
        this.string(file, n.left, seen, scope) +
        this.string(file, n.right, seen, scope)
      );
    }

    if (n.type === "Identifier") {
      const param = scope.get(n.name);

      return param ?? this.identifier(file, n.name, seen);
    }

    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      const args = n.arguments.map((arg) => {
        if (arg.type === "SpreadElement") {
          throw new EvaluationError("a spread is not a string it can evaluate");
        }

        return this.string(file, arg, seen, scope);
      });

      return this.call(file, n.callee.name, args, seen);
    }

    throw new EvaluationError(`a ${n.type} is not a string it can evaluate`);
  }

  /** `t('title')`: the function's one returned expression, with its parameters bound to the arguments. */
  private call(
    file: string,
    name: string,
    args: string[],
    seen: Set<string>
  ): string {
    const key = `${file}#${name}()`;

    if (seen.has(key)) {
      throw new EvaluationError(`\`${name}\` calls itself`);
    }

    const next = new Set(seen).add(key);
    const found = this.fragment(file, name, next);

    if (args.length !== found.fragment.params.length) {
      throw new EvaluationError(
        `\`${name}\` takes ${found.fragment.params.length} argument(s), and the call passes ${args.length}`
      );
    }

    const scope = new Map(
      found.fragment.params.map((param, i) => [param, args[i] ?? ""])
    );

    return this.string(found.file, found.fragment.body, next, scope);
  }

  /** Where the function `name` of `file` is defined, through relative imports and re-exports. */
  private fragment(file: string, name: string, seen: Set<string>): FragmentAt {
    const parsed = this.load(file);
    const own = parsed.functions.get(name);

    if (own) {
      return { file, fragment: own };
    }

    const imported = parsed.imports.get(name);

    if (imported?.file) {
      return this.exported(
        imported.file,
        imported.name,
        seen,
        (at, local, next) => this.fragment(at, local, next)
      );
    }

    throw new EvaluationError(
      `\`${name}\` is not a function of the site's own that returns one expression, with plain parameter names and no \`async\`, in ${path.relative(this.root, file)} or a file it imports by a relative path`
    );
  }

  private identifier(file: string, name: string, seen: Set<string>): string {
    const key = `${file}#${name}`;

    if (seen.has(key)) {
      throw new EvaluationError(`\`${name}\` refers to itself`);
    }

    const next = new Set(seen).add(key);
    const parsed = this.load(file);
    const init = parsed.consts.get(name);

    if (init) {
      return this.string(file, init, next);
    }

    const imported = parsed.imports.get(name);

    if (imported) {
      const own =
        imported.source === QUERY_MODULE
          ? PACKAGE_STRINGS.get(imported.name)
          : undefined;

      if (own !== undefined) {
        return own;
      }

      if (!imported.file) {
        throw new EvaluationError(
          `\`${name}\` comes from '${imported.source}'; only relative imports are followed`
        );
      }

      return this.exported(imported.file, imported.name, next, (at, local, n) =>
        this.identifier(at, local, n)
      );
    }

    throw new EvaluationError(
      `\`${name}\` is not a const in ${path.relative(this.root, file)}`
    );
  }

  private exported<T>(
    file: string,
    name: string,
    seen: Set<string>,
    local: (file: string, name: string, seen: Set<string>) => T
  ): T {
    // Kept apart from the local names: `export { X }` names a local `X`.
    const key = `${file}#export ${name}`;

    if (seen.has(key)) {
      throw new EvaluationError(
        `\`${name}\` is re-exported in a cycle through ${path.relative(this.root, file)}`
      );
    }

    const next = new Set(seen).add(key);
    this.deps.add(file);
    const parsed = this.load(file);
    const target = parsed.exports.get(name);

    if (target === undefined) {
      const from = parsed.starExports.find((star) =>
        this.provides(star, name, new Set([file]))
      );

      if (from) {
        return this.exported(from, name, next, local);
      }

      throw new EvaluationError(
        `${path.relative(this.root, file)} does not export \`${name}\``
      );
    }

    if ("local" in target) {
      return local(file, target.local, next);
    }

    if (!target.file) {
      throw new EvaluationError(
        `\`${name}\` is re-exported from a non-relative path`
      );
    }

    return this.exported(target.file, target.name, next, local);
  }

  /** Whether `file` exports `name`, itself or through `export * from`. */
  private provides(file: string, name: string, visited: Set<string>): boolean {
    if (visited.has(file)) {
      return false;
    }

    visited.add(file);
    this.deps.add(file);
    const parsed = this.load(file);

    return (
      parsed.exports.has(name) ||
      parsed.starExports.some((star) => this.provides(star, name, visited))
    );
  }
}

export function findQueries(root: string, file: string): QueryModule {
  const text = readFileSync(file, "utf-8");

  if (!text.includes("defineQuery")) {
    return { queries: [], errors: [], deps: [] };
  }

  const evaluator = new Evaluator(root);
  const parsed = evaluator.load(file, text);
  const queries: FoundQuery[] = [];
  const errors: string[] = [];

  for (const { name, init } of parsed.declarations) {
    const call = unwrap(init);

    if (call.type !== "CallExpression") {
      continue;
    }

    const { callee } = call;

    if (callee.type !== "Identifier" || !parsed.defineQuery.has(callee.name)) {
      continue;
    }

    const [arg] = call.arguments;

    try {
      if (!arg) {
        throw new EvaluationError(
          "`defineQuery` needs the query as its argument"
        );
      }

      if (arg.type === "SpreadElement") {
        throw new EvaluationError("a spread is not a string it can evaluate");
      }

      queries.push({ name, query: evaluator.string(file, arg, new Set()) });
    } catch (error) {
      if (!(error instanceof EvaluationError)) {
        throw error;
      }

      errors.push(`${path.relative(root, file)}: ${name}: ${error.message}`);
    }
  }

  evaluator.deps.delete(file);

  return { queries, errors, deps: [...evaluator.deps] };
}
