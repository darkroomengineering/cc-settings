import type { Deployment } from "visio/internal/deploy";

import { cloudflareEnv } from "./env.ts";
import { cloudflareOutput } from "./output.ts";
import type { CloudflareOptions } from "./output.ts";

export { bindings } from "@cloudflare/config/public";

export type { CloudflareOptions, Observability } from "./output.ts";

export type { Observe, ObserveArgs, ObserveKind } from "./runtime.ts";

/** A Cloudflare Worker with static assets: `dist/cloudflare`, which `wrangler deploy` deploys. */
export function cloudflare(options: CloudflareOptions = {}): Deployment {
  return {
    output: (facts) => cloudflareOutput(facts, options),
    env: cloudflareEnv,
  };
}
