/** A deploy target the push writes to and the build guards: `vercel()` and `cloudflare()` give one. */
export interface EnvPlatform {
  /** As the messages name it. */
  readonly name: string;
  /** The target this build runs for on the platform, or none off it (a laptop, CI). */
  readonly target: (
    env: Record<string, string | undefined>
  ) => EnvTarget | undefined;
  /** The targets the push can write; the build guards only these. */
  readonly targets: readonly EnvTarget[];
  /** Writes the values to the target, and says when they apply. */
  readonly push: (request: PushRequest) => Promise<string>;
}

export type EnvTarget = "preview" | "production";

export const TARGETS: readonly EnvTarget[] = ["preview", "production"];

/** The variable the push sets to the fingerprint of the file it pushed, and the build compares. */
export const HASH_VAR = "VISIO_ENV_HASH";

/** Decrypted values by name, as the push sends them. */
export type PushValues = Readonly<Record<string, string>>;

export interface PushRequest {
  target: EnvTarget;
  /** Server values: kept secret on the platform. */
  server: PushValues;
  /** Client values: public, read by the platform's build. */
  client: PushValues;
  /** The fingerprint for `HASH_VAR`. */
  hash: string;
  /** The project's own values the push reads its tokens and ids from: the local block, then the shell. */
  local: Record<string, string | undefined>;
  /** The project root. */
  root: string;
}

/** A JSON call to a platform's API, with its error as the message. */
export async function call<T>(
  platform: string,
  url: string,
  init: { method: string; token: string; body?: unknown }
): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${init.token}`,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `[@visio/env] [PUSH_FAILED] ${platform} answered ${response.status} to ${init.method} ${new URL(url).pathname}: ${text.slice(0, 500)}`
    );
  }

  // SAFETY: the caller names the shape the platform documents for this call.
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A value the push needs from the local block, or an error that names where it goes. */
export function needLocal(
  local: Record<string, string | undefined>,
  name: string,
  why: string
): string {
  const value = local[name];

  if (!value) {
    throw new Error(
      `[@visio/env] [LOCAL_MISSING] the push needs ${name}: ${why}. Add it to the local block of src/env.ts and to .env with \`dotenvx set ${name} <value>\`.`
    );
  }

  return value;
}
