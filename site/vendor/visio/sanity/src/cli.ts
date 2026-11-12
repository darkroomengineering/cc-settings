import path from "node:path";

import { STUDIO_DIR } from "./constants.ts";
import { typegen } from "./typegen.ts";

const HELP = `visio-sanity typegen

  Writes sanity.types.d.ts from the Studio's schema and the defineQuery
  constants in src/, as the dev server and the build do. Run it in the
  site's folder. Exit 1 when a query cannot be typed.
`;

export async function main(
  argv = process.argv.slice(2),
  root = process.cwd()
): Promise<number> {
  const [command = "help", ...rest] = argv;

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);

    return 0;
  }

  if (command !== "typegen" || rest.length) {
    process.stderr.write(`unknown arguments "${argv.join(" ")}"\n${HELP}`);

    return 2;
  }

  const result = await typegen(root, path.resolve(root, STUDIO_DIR));

  for (const error of result.errors) {
    process.stderr.write(`[@visio/sanity] ${error}\n`);
  }

  process.stdout.write(
    `[@visio/sanity] ${result.queries} queries, sanity.types.d.ts ${result.written ? "written" : "unchanged"}\n`
  );

  return result.errors.length ? 1 : 0;
}
