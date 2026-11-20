import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "public");
const routes: Record<string, Response | ((request: Request) => Response)> = {};
for (const name of readdirSync(root, { recursive: true })) {
  if (typeof name !== "string") continue;
  const file = Bun.file(join(root, name));
  if (!(await file.exists())) continue;
  routes[`/${name}`] = () => new Response(file);
}
for (const [route, name] of [["/", "index"], ["/privacy", "privacy"], ["/support", "support"]]) {
  const render = (request: Request) => {
    const markdown = request.headers.get("accept")?.includes("text/markdown");
    const file = Bun.file(join(root, `${name}.${markdown ? "md" : "html"}`));
    return new Response(file, { headers: { vary: "Accept", ...(markdown ? { "content-type": "text/markdown; charset=utf-8" } : {}) } });
  };
  routes[route] = render;
  if (route !== "/") routes[route + "/"] = render;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4318,
  routes,
  fetch: () => new Response(Bun.file(join(root, "404.html")), { status: 404 }),
});
console.log(`cc-settings preview: http://cc-settings.localhost:${server.port}/`);
