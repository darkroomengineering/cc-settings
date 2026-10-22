import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  claudeManagedManifestPaths,
} from "./claude-managed-file-manifests.ts";
import type { Profile } from "./light-profile.ts";

const SHA256 = /^[a-f0-9]{64}$/i;

export { CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION };

export async function claudeManagedAllowedPaths(
  sourceDir: string,
  profile: Profile,
  manifestVersion = CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
): Promise<Set<string>> {
  return new Set(claudeManagedManifestPaths(manifestVersion, profile, sourceDir));
}

function managedDestination(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Unsafe managed file path in Claude sentinel: ${relativePath}`);
  }
  const destination = resolve(root, relativePath);
  const fromRoot = relative(root, destination);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Managed file path escapes Claude home: ${relativePath}`);
  }
  return destination;
}

export async function validateClaudeManagedFileOwnership(
  managedFiles: Record<string, string>,
  sourceDir: string,
  profile: Profile,
  installedRoot: string,
  mode: "exact" | "upgrade" = "exact",
  manifestVersion = CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
): Promise<void> {
  const allowedPaths = await claudeManagedAllowedPaths(sourceDir, profile, manifestVersion);
  const mandatoryGeneratedPaths = [
    ".cc-settings-hooks-fingerprint",
    ".cc-settings-src-manifest",
    ...(profile === "full" ? [".cc-settings-baseline.json"] : []),
  ];
  for (const path of mandatoryGeneratedPaths) allowedPaths.add(path);

  const actualPaths = Object.keys(managedFiles);
  const unexpected = actualPaths.filter((path) => !allowedPaths.has(path));
  const missing = mandatoryGeneratedPaths.filter((path) => !(path in managedFiles));
  const allowLegacyUpgradeOmissions = mode === "upgrade" && manifestVersion === 1;
  for (const path of allowedPaths) {
    if (path in managedFiles || mandatoryGeneratedPaths.includes(path)) continue;
    if (!allowLegacyUpgradeOmissions) {
      missing.push(path);
      continue;
    }
    try {
      await lstat(managedDestination(installedRoot, path));
      missing.push(path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Invalid or incomplete managed_files ownership in Claude sentinel` +
        `${unexpected.length > 0 ? `; unexpected: ${unexpected.join(", ")}` : ""}` +
        `${missing.length > 0 ? `; missing: ${missing.join(", ")}` : ""}`,
    );
  }
  for (const [path, hash] of Object.entries(managedFiles)) {
    managedDestination(installedRoot, path);
    if (!SHA256.test(hash))
      throw new Error(`Invalid managed file hash in Claude sentinel: ${path}`);
  }
}
