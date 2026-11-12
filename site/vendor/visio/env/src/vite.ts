import { existsSync } from "node:fs";
import path from "node:path";

import { runnerImport } from "vite";
import type { Plugin, ResolvedConfig } from "vite";

import { checkFiles } from "./check.ts";
import {
  COMMITTED_FILES,
  fileFor,
  fingerprint,
  KEYS_FILE,
  readEnvFile,
} from "./files.ts";
import type { EnvFile } from "./files.ts";
import { HASH_VAR } from "./platform.ts";
import type { EnvPlatform, EnvTarget } from "./platform.ts";
import {
  CLIENT_KEY,
  formatIssues,
  READING_KEY,
  SCHEMA_KEY,
  schemaErrors,
  validate,
} from "./schema.ts";
import type { Issue, Schema, Validation, Validators } from "./schema.ts";

export { CLIENT_PREFIX } from "./schema.ts";

export const ENV_MODULE = "src/env.ts";

export interface EnvPluginOptions {
  /** The deployment, for the guard on its builds. */
  platform?: EnvPlatform | undefined;
}

const FOLDED: unique symbol = Symbol.for("@visio/env/folded");

function folded(): Map<string, string> {
  // SAFETY: only this module writes the slot, always a Map.
  const holder = globalThis as { [FOLDED]?: Map<string, string> };

  return (holder[FOLDED] ??= new Map());
}

function fold(file: EnvFile | undefined) {
  const names = folded();

  for (const [key, value] of names) {
    if (process.env[key] === value) {
      Reflect.deleteProperty(process.env, key);
    }
  }

  names.clear();

  for (const [key, value] of Object.entries(file?.values ?? {})) {
    if (!(key in process.env)) {
      process.env[key] = value;
      names.set(key, value);
    }
  }
}

interface EnvModule {
  readonly env?: { readonly [SCHEMA_KEY]?: Schema };
}

export interface LoadedSchema {
  schema: Schema;
  dependencies: string[];
}

/** Imports src/env.ts for its schema; `defineEnv()` validates nothing meanwhile. */
export async function readSchema(
  root: string
): Promise<LoadedSchema | undefined> {
  const file = path.join(root, ENV_MODULE);

  if (!existsSync(file)) {
    return undefined;
  }

  // SAFETY: the slot is a flag that only this function and defineEnv() read.
  const slots = globalThis as { [READING_KEY]?: boolean };

  slots[READING_KEY] = true;

  try {
    const { module, dependencies } = await runnerImport<EnvModule>(file, {
      root,
      configFile: false,
      envDir: false,
      logLevel: "error",
    });

    const extra = Object.keys(module).filter((key) => key !== "env");
    const schema = module.env?.[SCHEMA_KEY];

    if (!schema || extra.length > 0) {
      throw new Error(
        `[@visio/env] [ENV_MODULE_SHAPE] ${ENV_MODULE} exports only \`export const env = defineEnv({ server, client, local })\`${extra.length > 0 ? `, and it also exports ${extra.join(", ")}` : ""}. The client build replaces the whole file with the client values. Read .claude/skills/env/SKILL.md.`
      );
    }

    const errors = schemaErrors(schema);

    if (errors.length > 0) {
      throw new Error(
        `[@visio/env] [ENV_SCHEMA_INVALID] ${ENV_MODULE}:\n${errors.map((error) => `  ${error}`).join("\n")}`
      );
    }

    return {
      schema,
      dependencies: dependencies
        .map((dep) => path.resolve(root, dep))
        .filter((dep) => existsSync(dep)),
    };
  } finally {
    slots[READING_KEY] = false;
  }
}

function invalid(
  side: string,
  issues: readonly Issue[],
  file: EnvFile | undefined
): string {
  const locked =
    file && file.locked.length > 0
      ? `\n${file.locked.length} values in ${file.name} are encrypted and there is no ${file.keyName}: put the team's ${KEYS_FILE} in the project root, or set ${file.keyName}.`
      : "";

  return `[@visio/env] [ENV_INVALID] the ${side} env does not match ${ENV_MODULE}:\n${formatIssues(issues)}${locked}`;
}

const IMPORT =
  /\bimport\s*(?:\{(?<clause>[^}]*)\}|\*\s*as\s+(?<namespace>[\w$]+))\s*from\s*["'](?<specifier>[^"']+)["']/gu;

/** A primitive: what the bundle gets back unchanged from JSON. An object such as a URL or a Date does not. */
function isPlain(value: Validation<Validators>["values"][string]): boolean {
  return Object(value) !== value;
}

function isClient(environment: { config: { consumer: string } }) {
  return environment.config.consumer === "client";
}

function bare(id: string): string {
  return path.resolve(id.split("?")[0] ?? id);
}

function localNames(clause: string | undefined, namespace: string | undefined) {
  if (namespace) {
    return [`${namespace}.env`];
  }

  return (clause ?? "")
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/u))
    .filter(([imported]) => imported === "env")
    .map(([imported, local]) => local ?? imported ?? "env");
}

// A name in a string or a comment is text, not a read.
const TEXT =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu;

const ENV_SPECIFIER = /(?:^|\/)env(?:\.[cm]?[jt]s)?$/u;

function serverReads(
  source: string,
  locals: readonly string[],
  names: readonly string[]
): string[] {
  const code = source.replaceAll(TEXT, '""');
  const escaped = locals.map((local) => local.replaceAll(/[$.]/gu, "\\$&"));

  return names.filter((name) =>
    escaped.some(
      (local) =>
        new RegExp(
          `(?<![\\w$.])${local}\\s*(?:\\?\\.|\\.)\\s*${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*${local}\\b`,
          "u"
        ).test(code) ||
        // On the source: the key of `env["X"]` is a string, which `code` blanks.
        new RegExp(
          `(?<![\\w$.])${local}\\s*\\[\\s*["'\`]${name}["'\`]\\s*\\]`,
          "u"
        ).test(source)
    )
  );
}

export function env(options: EnvPluginOptions = {}): Plugin[] {
  let root = process.cwd();
  let config: ResolvedConfig;
  let target: EnvTarget | undefined;
  let file: EnvFile | undefined;
  let loading: Promise<Loaded | undefined> | undefined;
  let envModule = "";

  interface Loaded extends LoadedSchema {
    client: Validation<Validators>["values"];
    hidden: string[];
    secrets: [string, string][];
  }

  async function load(): Promise<Loaded | undefined> {
    const read = await readSchema(root);

    if (!read) {
      return undefined;
    }

    const { schema } = read;
    const isBuild = config.command === "build";

    // First: a file that was not pushed explains a missing value better.
    if (isBuild && target) {
      guard(schema, target);
    }

    const client = validate(schema.client, process.env);

    if (client.issues.length > 0) {
      throw new Error(invalid("client", client.issues, file));
    }

    const notPlain = Object.entries(client.values)
      .filter(([, value]) => !isPlain(value))
      .map(([key]) => key);

    if (notPlain.length > 0) {
      throw new Error(
        `[@visio/env] [CLIENT_VALUE_NOT_PLAIN] ${notPlain.join(", ")} in ${ENV_MODULE} ${notPlain.length === 1 ? "gives" : "give"} an object, and a client value goes into the bundle as JSON: a Date or a URL would arrive as a string. Give a string, a number or a boolean, and make the object where it is used.`
      );
    }

    // The crawl starts the server in this build, and the server needs every value.
    const server = validate(schema.server, process.env);

    if (server.issues.length > 0) {
      throw new Error(invalid("server", server.issues, file));
    }

    const findings = checkFiles(root, schema);

    if (findings.length > 0) {
      if (isBuild) {
        throw new Error(findings.join("\n"));
      }

      config.logger.warn(`\n${findings.join("\n")}\n`);
    }

    const clientValues = new Set(Object.values(client.values));

    return {
      ...read,
      client: client.values,
      hidden: [...Object.keys(schema.server), ...Object.keys(schema.local)],
      secrets: Object.keys(schema.server)
        .map((key): [string, string] => [key, process.env[key] ?? ""])
        .filter(([, value]) => value.length >= 8 && !clientValues.has(value)),
    };
  }

  function guard(schema: Schema, on: EnvTarget) {
    // A target the platform cannot push to has no fingerprint to compare.
    if (!options.platform?.targets.includes(on)) {
      return;
    }

    const name = `.env.${on}`;
    const committed = readEnvFile(root, name, false);

    if (!committed) {
      return;
    }

    const pushed = [
      ...Object.keys(schema.server),
      ...Object.keys(schema.client),
    ].filter((key) => key in committed.raw);

    const want = fingerprint(committed, pushed);
    const have = process.env[HASH_VAR];

    if (have !== want) {
      throw new Error(
        `[@visio/env] [ENV_NOT_PUSHED] ${name} ${have ? "changed since the last push" : "was never pushed"} to ${options.platform?.name ?? "the platform"} (${HASH_VAR} is ${have ?? "unset"}, the file gives ${want}). Run \`bun run env:push ${on}\` on a machine with the key, then deploy again.`
      );
    }
  }

  function ensure() {
    return (loading ??= load());
  }

  return [
    {
      name: "visio:env",
      enforce: "pre",
      api: { platform: options.platform },
      config(user, { mode }) {
        if (user.envDir !== undefined) {
          throw new Error(
            `[@visio/env] envDir is set, but a visio site reads ${COMMITTED_FILES.join(", ")} from the project root, through @visio/env. Remove envDir from vite.config.ts.`
          );
        }

        root = path.resolve(user.root ?? process.cwd());
        envModule = path.join(root, ENV_MODULE);

        if (existsSync(path.join(root, "env.ts")) && !existsSync(envModule)) {
          throw new Error(
            `[@visio/env] [ENV_MODULE_MOVED] env.ts is at the project root, and the env is now ${ENV_MODULE}: move it there, wrap its object in \`export const env = defineEnv({ ... })\` from @visio/env, import \`env\` from it by a relative path instead of virtual:solid-env/*, and delete solid-env.d.ts. Read .claude/skills/env/SKILL.md.`
          );
        }

        target = options.platform?.target(process.env);
        // On the platform the push set every value, and the build has no key.
        file = target ? undefined : readEnvFile(root, fileFor(mode));
        fold(file);
        loading = undefined;

        return { envDir: false };
      },
      configResolved(resolved) {
        config = resolved;

        if (file && file.locked.length > 0) {
          config.logger.warn(
            `[@visio/env] [KEY_MISSING] ${file.locked.join(", ")} in ${file.name} ${file.locked.length === 1 ? "is" : "are"} encrypted, and there is no ${file.keyName}, so ${file.locked.length === 1 ? "it stays" : "they stay"} unset. Put the team's ${KEYS_FILE} in the project root, or set ${file.keyName}.`
          );
        }
      },
      async buildStart() {
        try {
          await ensure();
        } catch (error) {
          if (config.command === "build") {
            throw error;
          }

          config.logger.error(
            `\n${error instanceof Error ? error.message : String(error)}\n`
          );
        }
      },
      transform: {
        filter: { id: /[\\/]src[\\/]env\.ts$/u },
        async handler(code, id) {
          if (bare(id) !== envModule) {
            return;
          }

          const loaded = await ensure();

          if (!loaded) {
            return;
          }

          if (isClient(this.environment)) {
            return {
              code: `export const env = Object.freeze(${JSON.stringify(loaded.client)});\n`,
              map: null,
            };
          }

          return {
            code: `globalThis[Symbol.for(${JSON.stringify(CLIENT_KEY.description)})] = ${JSON.stringify(loaded.client)};\n${code}`,
            map: null,
          };
        },
      },
      configureServer(server) {
        const watched = new Set(
          [...COMMITTED_FILES, KEYS_FILE].map((name) => path.join(root, name))
        );

        watched.add(envModule);
        server.watcher.add([...watched]);

        async function watchDependencies() {
          try {
            const loaded = await ensure();

            for (const dep of loaded?.dependencies ?? []) {
              watched.add(dep);
            }
          } catch {
            // buildStart prints the error; the restart on a fix reads it again.
          }
        }

        function restart(changed: string) {
          if (watched.has(changed)) {
            void server.restart();
          }
        }

        void watchDependencies();

        server.watcher.on("change", restart);
        server.watcher.on("add", restart);
        server.watcher.on("unlink", restart);
      },
    },
    {
      name: "visio:env-client",
      // After Solid's own transforms, which take server functions out of the client build.
      enforce: "post",
      async transform(code, id) {
        if (
          !isClient(this.environment) ||
          id.startsWith("\0") ||
          id.includes("/node_modules/") ||
          bare(id) === envModule
        ) {
          return;
        }

        const imports = [...code.matchAll(IMPORT)].flatMap((match) =>
          match.groups?.specifier && ENV_SPECIFIER.test(match.groups.specifier)
            ? [match.groups]
            : []
        );

        const resolved = await Promise.all(
          imports.map((groups) => this.resolve(groups.specifier ?? "", id))
        );

        const locals = imports.flatMap((groups, index) => {
          const found = resolved[index];

          return found && bare(found.id) === envModule
            ? localNames(groups.clause, groups.namespace)
            : [];
        });

        if (locals.length === 0) {
          return;
        }

        const loaded = await ensure();
        const names = serverReads(code, locals, loaded?.hidden ?? []);

        if (names.length > 0) {
          this.error(
            `[@visio/env] [SERVER_VAR_IN_CLIENT] ${path.relative(root, id.split("?")[0] ?? id)} reads ${names.join(", ")} from ${ENV_MODULE}, and this module runs in the browser too. A server or local var never reaches the browser: read it in server code ('use server', src/server/, middleware), or move it to client as PUBLIC_.`
          );
        }
      },
      async generateBundle(_options, bundle) {
        if (!isClient(this.environment) || config.command !== "build") {
          return;
        }

        const loaded = await ensure();
        const leaks: string[] = [];

        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "chunk") {
            continue;
          }

          for (const [key, value] of loaded?.secrets ?? []) {
            // Quoted, as a literal: a dataset named "production" is in many
            // chunks as a word. As JSON too: a key's newline is `\n` in a chunk.
            if (
              [JSON.stringify(value), `'${value}'`, `\`${value}\``].some(
                (literal) => chunk.code.includes(literal)
              )
            ) {
              leaks.push(`${key} in ${fileName}`);
            }
          }
        }

        if (leaks.length > 0) {
          this.error(
            `[@visio/env] [SERVER_VALUE_LEAKED] a server value is in the client bundle: ${leaks.join(", ")}. Look for a value pasted into code, or a server read in a module the browser loads.`
          );
        }
      },
    },
  ];
}
