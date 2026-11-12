import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEnv } from "node:util";

// The decryptor alone, on Node's own parser: dotenvx's parse() also expands
// `$(command)`, and a committed .env must not run a shell command in a build.
// SAFETY: the package ships no types; this is its decrypt(privateKey, value).
const { decrypt } = createRequire(import.meta.url)("@dotenvx/primitives") as {
  decrypt: (privateKey: string, value: string) => string;
};

export const DEV_FILE = ".env";

export const KEYS_FILE = ".env.keys";

export const COMMITTED_FILES = [DEV_FILE, ".env.preview", ".env.production"];

const ENCRYPTED = "encrypted:";

const PUBLIC_KEY = /^DOTENV_PUBLIC_KEY(?:_\w+)?$/u;

export function fileFor(mode: string): string {
  return mode === "development" ? DEV_FILE : `.env.${mode}`;
}

export interface EnvFile {
  /** The file name, such as `.env.production`. */
  name: string;
  /** Every name and its value as written, `DOTENV_PUBLIC_KEY*` left out. */
  raw: Record<string, string>;
  /** Every name the file could give: plain values, and encrypted ones its key opened. */
  values: Record<string, string>;
  /** Encrypted names with no key to open them. */
  locked: string[];
  /** The name of the private key, such as `DOTENV_PRIVATE_KEY_PRODUCTION`. */
  keyName: string;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED);
}

function keyNameOf(
  name: string,
  written: Record<string, string | undefined>
): string {
  const publicName = Object.keys(written).find((key) => PUBLIC_KEY.test(key));

  if (publicName) {
    return publicName.replace("PUBLIC", "PRIVATE");
  }

  const suffix = name
    .slice(DEV_FILE.length + 1)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "_");

  return suffix ? `DOTENV_PRIVATE_KEY_${suffix}` : "DOTENV_PRIVATE_KEY";
}

function privateKey(
  dir: string,
  keyName: string,
  source: Record<string, string | undefined>
): string | undefined {
  if (source[keyName]) {
    return source[keyName];
  }

  const keys = path.join(dir, KEYS_FILE);

  return existsSync(keys)
    ? parseEnv(readFileSync(keys, "utf-8"))[keyName] || undefined
    : undefined;
}

// A comma-separated list, as dotenvx takes it during a key rotation.
function open(keys: string, value: string, failure: string): string {
  let last: unknown;

  for (const key of keys.split(",")) {
    try {
      return decrypt(key.trim(), value);
    } catch (error) {
      last = error;
    }
  }

  const code =
    last instanceof Error && "code" in last
      ? String(last.code)
      : "decrypt failed";

  throw new Error(
    `[@visio/env] [KEY_WRONG] ${failure} (${code}). Get the current key from the team, in ${KEYS_FILE} or the environment.`,
    { cause: last }
  );
}

function withoutKey(
  written: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(written).filter(
      (entry): entry is [string, string] =>
        !PUBLIC_KEY.test(entry[0]) && entry[1] !== undefined
    )
  );
}

/** With `source` false it opens nothing: the check and the guard need only the ciphertext. */
export function readEnvFile(
  dir: string,
  name: string,
  source: Record<string, string | undefined> | false = process.env
): EnvFile | undefined {
  const file = path.join(dir, name);

  if (!existsSync(file)) {
    return undefined;
  }

  const written = parseEnv(readFileSync(file, "utf-8"));
  const keyName = keyNameOf(name, written);
  const raw = withoutKey(written);
  const key = source === false ? undefined : privateKey(dir, keyName, source);
  const values: Record<string, string> = {};
  const locked: string[] = [];

  for (const [entry, value] of Object.entries(raw)) {
    if (!isEncrypted(value)) {
      values[entry] = value;
    } else if (key) {
      values[entry] = open(
        key,
        value,
        `${keyName} does not open ${entry} in ${name}`
      );
    } else {
      locked.push(entry);
    }
  }

  return { name, raw, values, locked, keyName };
}

export function fingerprint(file: EnvFile, names: readonly string[]): string {
  const lines = [...names]
    .toSorted()
    .map((entry) => `${entry}=${file.raw[entry] ?? ""}`)
    .join("\n");

  return createHash("sha256").update(lines).digest("hex").slice(0, 16);
}
