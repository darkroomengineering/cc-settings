import {
  CLIENT_KEY,
  formatIssues,
  READING_KEY,
  SCHEMA_KEY,
  validate,
} from "./schema.ts";
import type { Schema, Validators, Values } from "./schema.ts";

export type { Validator } from "./schema.ts";

/** The blocks of `defineEnv()`. `local` names reach no deployment and no app code. */
export interface EnvOptions<
  Server extends Validators,
  Client extends Validators,
  Local extends Validators,
> {
  readonly server?: Server;
  readonly client?: Client;
  readonly local?: Local;
}

/** What `defineEnv()` returns: the server and client values, typed by their validators. */
export type Env<Server extends Validators, Client extends Validators> = Values<
  Server & Client
> & { readonly [SCHEMA_KEY]?: Schema };

type None = Readonly<Record<never, never>>;

interface Slots {
  [READING_KEY]?: boolean;
  [CLIENT_KEY]?: Readonly<Record<string, Values<Validators>[string]>>;
}

export function defineEnv<
  const Server extends Validators = None,
  const Client extends Validators = None,
  const Local extends Validators = None,
>(options: EnvOptions<Server, Client, Local>): Env<Server, Client> {
  const schema: Schema = {
    server: options.server ?? {},
    client: options.client ?? {},
    local: options.local ?? {},
  };

  // SAFETY: the plugin sets both slots, on this global, before src/env.ts runs.
  const slots = globalThis as Slots;

  if (slots[READING_KEY]) {
    // SAFETY: only the plugin and the push get it, and they read SCHEMA_KEY alone.
    return { [SCHEMA_KEY]: schema } as Env<Server, Client>;
  }

  const { values, issues } = validate(schema.server, process.env);

  if (issues.length > 0) {
    throw new Error(
      `[@visio/env] [ENV_INVALID] the server env does not match src/env.ts:\n${formatIssues(issues)}\nSet the variables on the deployment with \`bun run env:push\`, or in the .env file of this mode. Read .claude/skills/env/SKILL.md.`
    );
  }

  // SAFETY: the server values passed their validators, and the build validated the client ones.
  return Object.freeze({ ...slots[CLIENT_KEY], ...values }) as Env<
    Server,
    Client
  >;
}
