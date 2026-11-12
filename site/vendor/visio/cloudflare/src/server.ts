/** `binding()`: a binding of the Worker, read from server code. See DESIGN.md, Bindings. */

// The Worker sets it from `runtime.ts`, which imports nothing; the binding test of test/cloudflare.test.ts reads it through both.
const ENV_KEY: unique symbol = Symbol.for("@visio/cloudflare/env");

/** A service binding's `fetch`, as Cloudflare's `Fetcher` has it; name any other binding's type. */
export interface Fetcher {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface EnvHolder {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the Worker's env, whose bindings each have their own type.
  [ENV_KEY]?: { readonly [name: string]: object | string | undefined };
}

const warned = new Set<string>();

/** The binding `name` of the Worker, or undefined where there is none: `vite dev`, the crawl, a Preview. */
export function binding<T extends object = Fetcher>(
  name: string
): T | undefined {
  // SAFETY: only the Worker's runtime sets the key, to its env.
  const env = (globalThis as EnvHolder)[ENV_KEY];

  if (!env) {
    return undefined;
  }

  const value = env[name];

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the env holds the variables and secrets too, which are strings.
  if (typeof value === "object") {
    // SAFETY: Cloudflare gives each binding its own type; the caller names it.
    return value as T;
  }

  if (!warned.has(name)) {
    warned.add(name);
    console.warn(
      `[@visio/cloudflare] binding("${name}"): the Worker has no binding ${name}${value === undefined ? "" : ", only a variable or a secret"}. Add it to \`bindings\` of cloudflare() in vite.config.ts. A Preview has no binding, so there this is expected.`
    );
  }

  return undefined;
}
