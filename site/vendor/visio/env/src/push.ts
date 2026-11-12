import { loadConfigFromFile } from "vite";
import type { PluginOption } from "vite";

import { DEV_FILE, fingerprint, KEYS_FILE, readEnvFile } from "./files.ts";
import { TARGETS } from "./platform.ts";
import type { EnvPlatform, EnvTarget, PushValues } from "./platform.ts";
import { formatIssues, validate } from "./schema.ts";
import { ENV_MODULE, readSchema } from "./vite.ts";

interface Entry {
  readonly name?: string;
  readonly api?: { readonly platform?: EnvPlatform };
}

async function flatten(option: PluginOption): Promise<Entry[]> {
  const value = await option;

  if (Array.isArray(value)) {
    const nested = await Promise.all(value.map(flatten));

    return nested.flat();
  }

  return value ? [value] : [];
}

function isTarget(value: string): value is EnvTarget {
  return TARGETS.some((target) => target === value);
}

function pick(values: PushValues, names: readonly string[]): PushValues {
  const picked: Record<string, string> = {};

  for (const key of names) {
    const value = values[key];

    if (value !== undefined) {
      picked[key] = value;
    }
  }

  return picked;
}

export async function platformOf(root: string): Promise<EnvPlatform> {
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    undefined,
    root,
    "silent"
  );

  const plugins = await flatten(loaded?.config.plugins ?? []);

  const platform = plugins.find((entry) => entry.name === "visio:env")?.api
    ?.platform;

  if (!platform) {
    throw new Error(
      "[@visio/env] [PLATFORM_MISSING] vite.config.ts has no deploy target to push to. Set `deploy: vercel()` or `deploy: cloudflare()` in visio()."
    );
  }

  return platform;
}

export interface PushResult {
  platform: string;
  server: string[];
  client: string[];
  hash: string;
  /** When the platform applies them. */
  applies: string;
}

export async function push(
  root: string,
  on: string,
  platform?: EnvPlatform
): Promise<PushResult> {
  if (!isTarget(on)) {
    throw new Error(
      `[@visio/env] [TARGET_UNKNOWN] ${JSON.stringify(on)} is not a target: push ${TARGETS.join(" or ")}.`
    );
  }

  const read = await readSchema(root);

  if (!read) {
    throw new Error(
      `[@visio/env] [ENV_MODULE_MISSING] there is no ${ENV_MODULE} to tell which names to push.`
    );
  }

  const { schema } = read;
  const name = `.env.${on}`;
  const file = readEnvFile(root, name);

  if (!file) {
    throw new Error(
      `[@visio/env] [FILE_MISSING] there is no ${name} to push. Write it with \`dotenvx set NAME value -f ${name}\`.`
    );
  }

  if (file.locked.length > 0) {
    throw new Error(
      `[@visio/env] [KEY_MISSING] ${name} has encrypted values and there is no ${file.keyName}: put the team's ${KEYS_FILE} in the project root, or set ${file.keyName}.`
    );
  }

  const local = {
    ...process.env,
    ...readEnvFile(root, DEV_FILE)?.values,
    ...file.values,
  };

  const issues = [
    ...validate(schema.server, file.values).issues,
    ...validate(schema.client, file.values).issues,
    ...validate(schema.local, local).issues,
  ];

  if (issues.length > 0) {
    throw new Error(
      `[@visio/env] [ENV_INVALID] ${name} does not match ${ENV_MODULE}, so nothing was pushed:\n${formatIssues(issues)}`
    );
  }

  const server = pick(file.values, Object.keys(schema.server));
  const client = pick(file.values, Object.keys(schema.client));

  const hash = fingerprint(file, [
    ...Object.keys(server),
    ...Object.keys(client),
  ]);

  const deployment = platform ?? (await platformOf(root));

  const applies = await deployment.push({
    target: on,
    server,
    client,
    hash,
    local,
    root,
  });

  return {
    platform: deployment.name,
    server: Object.keys(server),
    client: Object.keys(client),
    hash,
    applies,
  };
}
