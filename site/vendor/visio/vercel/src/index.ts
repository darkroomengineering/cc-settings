import { fileURLToPath } from "node:url";

import type { Deployment } from "visio/internal/deploy";

import { vercelEnv } from "./env.ts";
import { vercelOutput } from "./output.ts";

/** The Vercel deployment: `.vercel/output`, which Vercel deploys as is. */
export function vercel(): Deployment {
  return {
    middleware: fileURLToPath(new URL("cache.ts", import.meta.url)),
    output: vercelOutput,
    env: vercelEnv,
  };
}
