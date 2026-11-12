import { vercel } from "@visio/vercel";
import { visio } from "visio";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // What visio() wires and in which order: vendor/visio/visio/DESIGN.md.
    // The origin and whether search engines may index the deployment come
    // from PUBLIC_SITE_URL and PUBLIC_SITE_INDEXABLE in the env.
    visio({
      site: {
        name: "cc-settings",
        locale: "en_US",
        image: {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "A green terminal prompt next to the name cc-settings, the line Darkroom's setup for Claude Code and Codex, and the command npx darkroom-settings",
        },
      },
      deploy: vercel(),
    }),
  ],
  server: {
    port: 3000,
  },
});
