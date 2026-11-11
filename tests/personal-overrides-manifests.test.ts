import { expect, test } from "bun:test";
import {
  CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  claudeManagedManifestPaths,
} from "../src/lib/claude-managed-file-manifests.ts";
import {
  CURRENT_RUNTIME_MANIFEST_VERSION,
  runtimePathsForVersion,
} from "../src/lib/codex-runtime-manifests.ts";

test("personal overrides runtime sources belong only to the new manifest versions", () => {
  expect(CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION).toBe(47);
  expect(CURRENT_RUNTIME_MANIFEST_VERSION).toBe(34);
  for (const path of ["src/lib/personal-overrides.ts", "src/schemas/personal-overrides.ts"]) {
    expect(runtimePathsForVersion(33, "test")).not.toContain(path);
    expect(runtimePathsForVersion(34, "test")).toContain(path);
    for (const profile of ["full", "light"] as const) {
      expect(claudeManagedManifestPaths(46, profile, "test")).not.toContain(path);
      expect(claudeManagedManifestPaths(47, profile, "test")).toContain(path);
    }
  }
});
