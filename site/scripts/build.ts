import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(root, ".vercel", "output");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(root, "public"), join(output, "static"), { recursive: true });

const indexable = process.env.PUBLIC_SITE_INDEXABLE === "true";
const headers = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  ...(!indexable ? { "x-robots-tag": "noindex" } : {}),
};
const pages = [["^/$", "index"], ["^/privacy/?$", "privacy"], ["^/support/?$", "support"]];
const acceptsMarkdown = [{ type: "header", key: "accept", value: ".*text/markdown.*" }];
const routes = [
  { src: "^/.*$", headers, continue: true },
  ...pages.map(([src, page]) => ({ src, has: acceptsMarkdown, dest: `/${page}.md`, headers: { vary: "Accept", "content-type": "text/markdown; charset=utf-8" } })),
  ...pages.map(([src, page]) => ({ src, dest: `/${page}.html`, headers: { vary: "Accept" } })),
  { handle: "filesystem" },
  { src: "^/.*$", dest: "/404.html", status: 404 },
];
await Bun.write(join(output, "config.json"), JSON.stringify({ version: 3, routes }, null, 2) + "\n");
console.log("Built static cc-settings site in .vercel/output");
