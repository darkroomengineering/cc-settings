import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  visio?: { stylesheets?: string[] };
}

function isVisio(name: string) {
  return name === "visio" || name.startsWith("@visio/");
}

function read(dir: string): Manifest {
  // SAFETY: an installed package's package.json; every field read here is
  // optional and has a fallback.
  return JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf-8")
  ) as Manifest;
}

// Not require.resolve(`${name}/package.json`): a package whose `exports`
// leaves out ./package.json throws there.
function findPackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);

    if (existsSync(path.join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }

    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
}

/**
 * The stylesheets the site's visio packages declare in `visio.stylesheets`,
 * a dependency's before its dependent's. A path resolves from the package
 * that declares it.
 */
export function packageCss(root: string): string {
  if (!existsSync(path.join(root, "package.json"))) {
    return "";
  }

  const seen = new Set<string>();
  const sheets: string[] = [];

  function visit(dir: string, names: string[]) {
    for (const name of names.filter(isVisio)) {
      const found = findPackage(name, dir);

      if (!found || seen.has(found)) {
        continue;
      }

      seen.add(found);
      const manifest = read(found);
      visit(found, Object.keys(manifest.dependencies ?? {}));
      const require = createRequire(path.join(found, "package.json"));

      for (const file of manifest.visio?.stylesheets ?? []) {
        let resolved: string;

        try {
          resolved = file.startsWith(".")
            ? path.resolve(found, file)
            : require.resolve(file);
          sheets.push(readFileSync(resolved, "utf-8"));
        } catch {
          throw new Error(
            `[@visio/styling] ${name} declares the stylesheet ${file} in visio.stylesheets, but it does not resolve from ${found}.`
          );
        }
      }
    }
  }

  const site = read(root);
  visit(root, Object.keys({ ...site.dependencies, ...site.devDependencies }));

  return sheets.join("\n");
}
