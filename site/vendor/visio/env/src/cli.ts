#!/usr/bin/env bun
import { push } from "./push.ts";

const [command, target] = process.argv.slice(2);

if (command !== "push" || !target) {
  console.error(
    "[@visio/env] usage: visio-env push <preview|production>, in the project root."
  );
  process.exit(1);
}

try {
  const result = await push(process.cwd(), target);
  console.log(
    `[@visio/env] pushed ${result.server.length} server and ${result.client.length} client values to ${result.platform} ${target} (${result.hash}). ${result.applies}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
