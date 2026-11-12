import { DEV_FILE, readEnvFile } from "@visio/env/internal/files";
import { defineCliConfig } from "sanity/cli";

import { DEFAULT_STUDIO_PATH } from "./constants.ts";

// The site's dev server and build pass the site's pair. `sanity` run on its
// own in studio/ reads it from the site's .env, decrypted; a variable already set wins.
for (const [key, value] of Object.entries(
  readEnvFile("../site", DEV_FILE)?.values ?? {}
)) {
  process.env[key] ??= value;
}

// Never assign undefined: process.env stores it as the string "undefined",
// and the Studio would ask Sanity for a project of that id.
for (const [studio, site] of [
  ["SANITY_STUDIO_PROJECT_ID", "SANITY_PROJECT_ID"],
  ["SANITY_STUDIO_DATASET", "SANITY_DATASET"],
] as const) {
  if (!process.env[studio] && process.env[site]) {
    process.env[studio] = process.env[site];
  }
}

/** The Studio's peers: one copy each, the Studio's, though this package resolves its own. */
const DEDUPE = ["sanity", "react", "react-dom", "styled-components"];

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || "unset",
    dataset: process.env.SANITY_STUDIO_DATASET || "production",
  },
  // Only here: set in the Studio's config as well, it applies twice (/studio/studio).
  project: {
    basePath: process.env.SANITY_STUDIO_BASE_PATH || DEFAULT_STUDIO_PATH,
  },
  vite: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      dedupe: [...(config.resolve?.dedupe ?? []), ...DEDUPE],
    },
  }),
});
