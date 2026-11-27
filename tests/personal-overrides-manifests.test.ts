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
  expect(CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION).toBeGreaterThanOrEqual(47);
  expect(CURRENT_RUNTIME_MANIFEST_VERSION).toBeGreaterThanOrEqual(34);
  for (const path of ["src/lib/personal-overrides.ts", "src/schemas/personal-overrides.ts"]) {
    expect(runtimePathsForVersion(33, "test")).not.toContain(path);
    expect(runtimePathsForVersion(34, "test")).toContain(path);
    for (const profile of ["full", "light"] as const) {
      expect(claudeManagedManifestPaths(46, profile, "test")).not.toContain(path);
      expect(claudeManagedManifestPaths(47, profile, "test")).toContain(path);
    }
  }
});

test("the verify-app template belongs only to the new manifest versions", () => {
  const path = "skills/proof-of-work/references/verify-app-template.md";
  expect(runtimePathsForVersion(34, "test")).not.toContain(path);
  expect(runtimePathsForVersion(35, "test")).toContain(path);
  expect(claudeManagedManifestPaths(47, "full", "test")).not.toContain(path);
  expect(claudeManagedManifestPaths(48, "full", "test")).toContain(path);
  expect(claudeManagedManifestPaths(48, "light", "test")).not.toContain(path);
});

test("the native-apps profile and platform design rules belong only to the new manifest versions", () => {
  const paths = [
    "profiles/native-apps.md",
    "skills/audit/references/platform-checks.md",
    "rules/android-design.md",
    "rules/apple-design.md",
    "rules/windows-design.md",
  ];
  for (const path of paths) {
    expect(claudeManagedManifestPaths(48, "full", "test")).not.toContain(path);
    expect(claudeManagedManifestPaths(49, "full", "test")).toContain(path);
    expect(claudeManagedManifestPaths(49, "light", "test")).not.toContain(path);
  }
});

test("the case-study fake data layer and leak check belong only to the new manifest versions", () => {
  for (const path of [
    "skills/case-study/scripts/browser/fakedata.js",
    "skills/case-study/scripts/browser/leakcheck.js",
  ]) {
    expect(runtimePathsForVersion(36, "test")).not.toContain(path);
    expect(runtimePathsForVersion(37, "test")).toContain(path);
    expect(claudeManagedManifestPaths(49, "full", "test")).not.toContain(path);
    expect(claudeManagedManifestPaths(50, "full", "test")).toContain(path);
    expect(claudeManagedManifestPaths(50, "light", "test")).not.toContain(path);
  }
});

test("the platform audit checks belong only to the new runtime manifest version", () => {
  const path = "skills/audit/references/platform-checks.md";
  expect(runtimePathsForVersion(35, "test")).not.toContain(path);
  expect(runtimePathsForVersion(36, "test")).toContain(path);
});

test("the ship skill installs as land from the new manifest versions", () => {
  const before = "skills/ship/SKILL.md";
  const after = "skills/land/SKILL.md";
  expect(runtimePathsForVersion(37, "test")).toContain(before);
  expect(runtimePathsForVersion(38, "test")).not.toContain(before);
  expect(runtimePathsForVersion(38, "test")).toContain(after);
  for (const profile of ["full", "light"] as const) {
    const old = claudeManagedManifestPaths(50, profile, "test");
    const next = claudeManagedManifestPaths(51, profile, "test");
    expect(next).not.toContain(before);
    expect(next.includes(after)).toBe(old.includes(before));
  }
});

test("the git-cow worktree hook and helper belong only to the new manifest versions", () => {
  for (const profile of ["full", "light"] as const) {
    for (const path of ["src/hooks/worktree-cow.ts", "src/lib/git-cow.ts"]) {
      expect(claudeManagedManifestPaths(51, profile, "test")).not.toContain(path);
      expect(claudeManagedManifestPaths(52, profile, "test")).toContain(path);
    }
  }
  expect(runtimePathsForVersion(38, "test")).not.toContain("src/lib/git-cow.ts");
  expect(runtimePathsForVersion(39, "test")).toContain("src/lib/git-cow.ts");
  expect(runtimePathsForVersion(39, "test")).not.toContain("src/hooks/worktree-cow.ts");
});
