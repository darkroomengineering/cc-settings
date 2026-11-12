// See DESIGN.md, "Password gate".
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PASSWORD_VAR } from "@visio/gate/internal/gate";
import { transformWithOxc } from "vite";

export const MIDDLEWARE = "_middleware";

export function gateRoute() {
  return { src: "^/(.*)$", middlewarePath: MIDDLEWARE, continue: true };
}

export async function writeGate(functions: string, open: readonly string[]) {
  const dir = path.join(functions, `${MIDDLEWARE}.func`);
  mkdirSync(dir, { recursive: true });

  // The entry only re-exports; the edge function needs the file that holds the code.
  const file = fileURLToPath(
    new URL("gate.ts", import.meta.resolve("@visio/gate/internal/gate"))
  );

  const gate = await transformWithOxc(readFileSync(file, "utf-8"), "gate.ts", {
    lang: "ts",
  });

  writeFileSync(path.join(dir, "gate.js"), gate.code);
  writeFileSync(
    path.join(dir, "index.js"),
    [
      `import { gateMiddleware } from './gate.js';`,
      `export default gateMiddleware(${JSON.stringify({ open })});`,
      "",
    ].join("\n")
  );
  writeFileSync(
    path.join(dir, ".vc-config.json"),
    `${JSON.stringify(
      { runtime: "edge", entrypoint: "index.js", envVarsInUse: [PASSWORD_VAR] },
      null,
      2
    )}\n`
  );
}
