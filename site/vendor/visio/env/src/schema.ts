/** What a validator gets: the variable as the file or the shell gives it. */
export type Raw = string | undefined;

/** A Standard Schema validator (valibot, zod, arktype). */
export interface Validator<Value = unknown> {
  readonly "~standard": {
    readonly validate: (
      value: Raw
    ) => ValidationResult<Value> | Promise<ValidationResult<Value>>;
    readonly types?: { readonly output: Value } | undefined;
  };
}

type ValidationResult<Value> =
  | { readonly value: Value; readonly issues?: undefined }
  | {
      readonly issues: readonly { readonly message: string }[];
    };

export type Validators = Readonly<Record<string, Validator>>;

export type Output<V> = V extends Validator<infer O> ? O : never;

/** The values of `V`, each typed by its validator. */
export type Values<V extends Validators> = {
  readonly [K in keyof V]: Output<V[K]>;
};

/** The three blocks of `defineEnv()`. */
export interface Schema {
  readonly server: Validators;
  readonly client: Validators;
  readonly local: Validators;
}

export type Side = keyof Schema;

export const SIDES: readonly Side[] = ["server", "client", "local"];

export const CLIENT_PREFIX = "PUBLIC_";

/** Where `defineEnv()` keeps its schema, for the plugin and the push to read. */
export const SCHEMA_KEY: unique symbol = Symbol.for("@visio/env/schema");

/** Set while the plugin imports src/env.ts for its schema: `defineEnv()` then validates nothing. */
export const READING_KEY: unique symbol = Symbol.for("@visio/env/reading");

/** The client values of the build, set by the plugin ahead of `defineEnv()` in the server build. */
export const CLIENT_KEY: unique symbol = Symbol.for("@visio/env/client");

export type Source = Readonly<Record<string, Raw>>;

export interface Issue {
  key: string;
  message: string;
}

export interface Validation<V extends Validators> {
  values: Partial<Values<V>>;
  issues: Issue[];
}

/** Validates every name of `validators` against `source`, synchronously. */
export function validate<V extends Validators>(
  validators: V,
  source: Source
): Validation<V> {
  const values: { -readonly [K in keyof V]?: Output<V[K]> } = {};
  const issues: Issue[] = [];

  for (const key of Object.keys(validators)) {
    const result = validators[key]?.["~standard"].validate(source[key]);

    if (result === undefined) {
      continue;
    }

    if (result instanceof Promise) {
      issues.push({
        key,
        message:
          "the validator is async. The server checks its env synchronously when it starts; make the validator synchronous.",
      });
    } else if (result.issues) {
      for (const issue of result.issues) {
        issues.push({ key, message: issue.message });
      }
    } else {
      // SAFETY: `result` is the output of the validator of `key`.
      values[key as keyof V] = result.value as Output<V[keyof V]>;
    }
  }

  return { values, issues };
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map(({ key, message }) => `  ${key}: ${message}`).join("\n");
}

/** The schema's shape errors: a client var without the prefix, a server or local var with it, a name in two blocks. */
export function schemaErrors(schema: Schema): string[] {
  const errors: string[] = [];
  const seen = new Map<string, Side>();

  for (const side of SIDES) {
    for (const key of Object.keys(schema[side])) {
      const isPublic = key.startsWith(CLIENT_PREFIX);

      if (side === "client" && !isPublic) {
        errors.push(
          `${key} is in the client block, and a client var starts with ${CLIENT_PREFIX}: rename it ${CLIENT_PREFIX}${key}, or move it to server.`
        );
      }

      if (side !== "client" && isPublic) {
        errors.push(
          `${key} is in the ${side} block, and a name with ${CLIENT_PREFIX} is a client var: move it to client, or drop the prefix.`
        );
      }

      const other = seen.get(key);

      if (other) {
        errors.push(`${key} is in both ${other} and ${side}: keep one.`);
      }

      seen.set(key, side);
    }
  }

  return errors;
}
