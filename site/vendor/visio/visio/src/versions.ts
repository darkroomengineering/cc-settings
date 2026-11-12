import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The installed version of `name`, resolved like a bare import from `root` upward. */
export function installedVersion(
  root: string,
  name: string
): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", name, "package.json");

    if (existsSync(file)) {
      // SAFETY: an npm package.json is an object, and its version is a string when present.
      const pkg = JSON.parse(readFileSync(file, "utf-8")) as {
        version?: string;
      };

      return pkg.version ?? "0.0.0";
    }

    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
}

function parseVersion(v: string) {
  const [core = "", pre] = v.replace(/\+.*/su, "").split(/-(?<pre>.*)/su);

  return {
    core: core.split(".").map(Number),
    pre: pre === undefined ? [] : pre.split("."),
  };
}

/** Semver order, prereleases included. Negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);

  for (let i = 0; i < 3; i += 1) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);

    if (d) {
      return d;
    }
  }

  // A release sorts after its prereleases.
  if (!x.pre.length || !y.pre.length) {
    return y.pre.length - x.pre.length;
  }

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];

    if (p === undefined) {
      return -1;
    }

    if (q === undefined) {
      return 1;
    }

    const d = comparePrerelease(p, q);

    if (d) {
      return d;
    }
  }

  return 0;
}

function comparePrerelease(p: string, q: string): number {
  if (/^\d+$/u.test(p) && /^\d+$/u.test(q)) {
    return Number(p) - Number(q);
  }

  if (p < q) {
    return -1;
  }

  return p > q ? 1 : 0;
}

const SOLID_PACKAGES = ["solid-js", "@solidjs/web", "@solidjs/router"];

/** The Solid versions visio is tested with: the lower bounds of its peer ranges. */
function testedVersions(): Record<string, string> {
  // SAFETY: visio's own package.json, which declares its Solid peers.
  const own = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8")
  ) as {
    peerDependencies: Record<string, string>;
  };

  return Object.fromEntries(
    SOLID_PACKAGES.map((name) => {
      const range = own.peerDependencies[name];

      if (range === undefined) {
        throw new Error(
          `[visio] visio's package.json has no peer range for ${name}.`
        );
      }

      return [name, range.replace(/^>=/u, "")];
    })
  );
}

/**
 * Throws when a Solid package is older than tested or `@solidjs/web` is not
 * the `solid-js` release; a mismatch otherwise shows only as `MISSING_EXPORT`
 * errors. Returns warnings for newer versions.
 */
export function checkSolidVersions(
  root: string,
  tested = testedVersions()
): string[] {
  const found = Object.fromEntries(
    SOLID_PACKAGES.map((n) => [n, installedVersion(root, n)])
  );

  const problems: string[] = [];
  const warnings: string[] = [];

  for (const [name, version] of Object.entries(found)) {
    const want = tested[name];

    if (version === undefined || want === undefined) {
      continue;
    }

    const order = compareVersions(version, want);

    if (order < 0) {
      problems.push(`${name} ${version} is older than ${want}.`);
    } else if (order > 0) {
      warnings.push(
        `[visio] ${name} ${version} is newer than ${want}, the version visio is tested with.`
      );
    }
  }

  const runtime = found["solid-js"];
  const web = found["@solidjs/web"];

  if (runtime && web && runtime !== web) {
    problems.push(
      `@solidjs/web ${web} is not the solid-js release (${runtime}); they ship together.`
    );
  }

  if (problems.length) {
    throw new Error(
      [
        "[visio] This site does not have the Solid visio is built for.",
        ...problems.map((p) => `  ${p}`),
        "Install the versions visio is tested with:",
        `  bun add ${SOLID_PACKAGES.values()
          .filter((n) => tested[n] && found[n])
          .map((n) => `${n}@${tested[n]}`)
          .toArray()
          .join(" ")}`,
      ].join("\n")
    );
  }

  return warnings;
}
