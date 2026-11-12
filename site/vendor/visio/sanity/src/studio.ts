import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

import type { Connect } from "vite";

/**
 * Redirects `/studio` to `/studio/`. With `fallback`, extensionless deeper
 * paths get the Studio's `index.html`.
 */
export function studioMiddleware(
  base: string,
  fallback?: string
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? "";
    const query = url.indexOf("?");
    const pathname = query === -1 ? url : url.slice(0, query);

    if (pathname === base) {
      res.statusCode = 308;
      res.setHeader("location", `${base}/${url.slice(pathname.length)}`);
      res.end();

      return;
    }

    if (
      fallback &&
      pathname.startsWith(`${base}/`) &&
      !path.extname(pathname)
    ) {
      req.url = fallback;
    }

    next();
  };
}

/** `sanity build` writes the icon links at `/static/` whatever the base path. */
export function studioIcons(html: string, base: string): string {
  return html.replaceAll('href="/static/', `href="${base}/static/`);
}

/** Whether something already listens on the port, a `sanity dev` started by hand. */
function listening(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = connect(port, "localhost");
  socket.once("connect", () => {
    socket.end();
    resolve(true);
  });
  socket.once("error", () => resolve(false));

  return promise;
}

/**
 * Resolves when the `sanity dev` this process started has exited. A restarted
 * dev server's Studio waits for it, or it finds the port taken and starts nothing.
 */
let studioExited: Promise<void> | undefined;

/**
 * Starts `sanity dev` unless something listens on `port`; returns what stops
 * it. A Studio that ignores SIGTERM gets SIGKILL after `grace` ms, so a
 * restart never waits for ever.
 */
export async function startStudio(
  command: string,
  args: string[],
  cwd: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  grace = 5000
): Promise<(() => void) | undefined> {
  await studioExited;

  if (await listening(port)) {
    return undefined;
  }

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  function stop() {
    child.kill();
    setTimeout(() => child.kill("SIGKILL"), grace).unref();
  }

  process.once("exit", stop);
  const ended = Promise.withResolvers<"exit" | "error">();
  child.once("exit", () => ended.resolve("exit"));
  child.once("error", () => ended.resolve("error"));

  async function forget() {
    await ended.promise;
    process.off("exit", stop);
  }

  studioExited = forget();

  return stop;
}

/** Starts the Studio for one dev server and stops it when that server closes. */
export function studioForServer(
  server:
    | { once: (event: "close", listener: () => void) => void }
    | null
    | undefined,
  start: () => Promise<(() => void) | undefined>,
  onError: (error: unknown) => void
): void {
  let closed = false;
  server?.once("close", () => {
    closed = true;
  });

  async function run() {
    let stop: (() => void) | undefined;

    try {
      stop = await start();
    } catch (error) {
      onError(error);

      return;
    }

    if (!stop) {
      return;
    }

    if (closed) {
      stop();
    } else {
      server?.once("close", stop);
    }
  }

  run();
}

/** The variables the package reads as the project and dataset. */
const PROJECT_VARIABLES = ["SANITY_PROJECT_ID", "SANITY_DATASET"] as const;

/**
 * The warning for a site that has queries but no project, or `undefined`.
 * Without it the error waits for the first read, and a read only a live
 * route makes gets past the build's crawl.
 */
export function unsetProject(
  env: Record<string, string | undefined>,
  queries: number
): string | undefined {
  const missing = PROJECT_VARIABLES.filter((name) => !env[name]);

  if (!queries || !missing.length) {
    return undefined;
  }

  const count = `${queries} ${queries === 1 ? "query" : "queries"}`;

  return (
    `[@visio/sanity] ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set, ` +
    `and the site has ${count}. Every fetchQuery throws until ${missing.length > 1 ? "they are" : "it is"}: ` +
    "set them in the site's .env with `dotenvx set` or in the host's environment. The Studio reads the same pair."
  );
}

export function deploying(env: Record<string, string | undefined>): boolean {
  return Boolean(env.VERCEL || env.WORKERS_CI);
}

export function unsetRevalidateSecret(
  env: Record<string, string | undefined>
): string | undefined {
  // Only a deployment gets publishes: a local build or CI has nothing to refresh.
  if (env.SANITY_REVALIDATE_SECRET || !deploying(env)) {
    return undefined;
  }

  return (
    "[@visio/sanity] [REVALIDATE_SECRET_UNSET] SANITY_REVALIDATE_SECRET is not set in the build's environment. " +
    "Without it at runtime a publish does not reach the site: the publish webhook gets a 500, and pages show new content " +
    "only when their hour is up. Set it in the host's environment, as a build variable too on Workers Builds, " +
    "and as the secret of the GROQ webhook (the sanity skill, references/preview.md, step 3)."
  );
}

export function unsetStudioProject(studioPath: string): string {
  return (
    `[@visio/sanity] [PROJECT_ID_UNSET] SANITY_PROJECT_ID is not set, so the Studio at ${studioPath} is built without a project ` +
    'and fails in the browser with "Configuration must contain `projectId`". Set SANITY_PROJECT_ID and SANITY_DATASET in the ' +
    "host's environment (on Vercel: Settings, Environment Variables) or the site's .env. The Studio reads the same pair: " +
    "there is no SANITY_STUDIO_ variable to set."
  );
}

/**
 * The first `node` on `PATH` that is not Bun. The Sanity CLI does not run on
 * Bun, and under `bun --bun` Bun puts a `node` of its own first on `PATH`, so
 * the bin's `#!/usr/bin/env node` would start Bun.
 */
export function nodeBinary(
  pathList = process.env.PATH ?? "",
  bun = process.versions.bun ? process.execPath : undefined
): string {
  const name = process.platform === "win32" ? "node.exe" : "node";

  function isBun(file: string) {
    return bun !== undefined && realpathSync(file) === realpathSync(bun);
  }

  for (const dir of pathList.split(path.delimiter)) {
    const file = path.join(dir, name);

    if (dir && existsSync(file) && !isBun(file)) {
      return file;
    }
  }

  throw new Error(
    "[@visio/sanity] The Sanity Studio runs on Node, and no Node is on PATH. Install Node 22.18 or later."
  );
}
