import { execFileSync } from "node:child_process";

import {
  COMMITTED_FILES,
  isEncrypted,
  KEYS_FILE,
  readEnvFile,
} from "./files.ts";
import { SIDES } from "./schema.ts";
import type { Schema } from "./schema.ts";

function tracked(root: string): Set<string> | undefined {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--", ...COMMITTED_FILES, KEYS_FILE],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );

    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return undefined;
  }
}

export function checkFiles(root: string, schema: Schema): string[] {
  const files = tracked(root);

  if (!files) {
    return [];
  }

  const findings: string[] = [];

  if (files.has(KEYS_FILE)) {
    findings.push(
      `[@visio/env] [KEYS_COMMITTED] ${KEYS_FILE} is in git, and it opens every encrypted value. Run \`git rm --cached ${KEYS_FILE}\`, add it to .gitignore, and rotate the keys with \`dotenvx rotate\`.`
    );
  }

  const declared = new Map<string, string>();

  for (const side of SIDES) {
    for (const key of Object.keys(schema[side])) {
      declared.set(key, side);
    }
  }

  for (const name of COMMITTED_FILES) {
    if (!files.has(name)) {
      continue;
    }

    const file = readEnvFile(root, name, false);

    if (!file) {
      continue;
    }

    for (const [key, value] of Object.entries(file.raw)) {
      const side = declared.get(key);

      if (side === undefined) {
        findings.push(
          `[@visio/env] [VAR_UNDECLARED] ${key} is in ${name}, and src/env.ts does not declare it, so the push skips it and no code reads it typed. Declare it in server, client or local, or remove it with \`dotenvx set\`.`
        );
      } else if (side === "server" && value !== "" && !isEncrypted(value)) {
        findings.push(
          `[@visio/env] [SECRET_PLAIN] ${key} is a server var in plain text in ${name}, which is in git. Encrypt it with \`dotenvx encrypt -f ${name} -k ${key}\`.`
        );
      }
    }
  }

  return findings;
}
