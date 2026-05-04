// Project stack detection. Used by scaffolding skills (component, hook, init,
// build, lenis, etc.) to emit framework-correct code shapes. Rules don't use
// this — they describe principles and let the model adapt from visible imports
// in the editing context.
//
// Detection runs against the project's package.json, config files, and folder
// shape (in that order of authority). Returns an evidence array so the caller
// can reason about ambiguous cases (monorepos with multiple stacks, mid-
// migration projects, etc.) rather than being forced into a binary verdict.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type StackKind =
  | "nextjs"
  | "react-router"
  | "vite-react"
  | "react-native"
  | "tauri"
  | "unknown";

export type Starter = "satus" | "novus" | null;

export interface Stack {
  /** Primary framework detected. `unknown` when no signals match. */
  kind: StackKind;
  /** Darkroom starter lineage if detectable from package.json metadata. */
  starter: Starter;
  /**
   * Other framework signals that were also present. A monorepo or mid-
   * migration project may have multiple. The caller decides whether to
   * branch, prompt, or warn.
   */
  alsoDetected: StackKind[];
  /** Human-readable reasons for each detection — surface to the user when explaining. */
  evidence: string[];
  /** Resolved cwd that was inspected. */
  cwd: string;
}

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  darkroom?: { starter?: string };
}

const NEXT_CONFIG_NAMES = [
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  "next.config.cjs",
];
const RR_CONFIG_NAMES = ["react-router.config.js", "react-router.config.ts"];
const VITE_CONFIG_NAMES = ["vite.config.js", "vite.config.ts", "vite.config.mjs"];
const TAURI_CONFIG_NAMES = ["src-tauri/tauri.conf.json", "tauri.conf.json"];

async function readPackageJson(cwd: string): Promise<PackageJson | null> {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

function hasAnyConfig(cwd: string, names: string[]): string | null {
  for (const name of names) {
    if (existsSync(join(cwd, name))) return name;
  }
  return null;
}

function detectStarter(pkg: PackageJson | null): Starter {
  if (!pkg) return null;
  // Explicit marker wins (recommended for forks that change name).
  const marker = pkg.darkroom?.starter;
  if (marker === "satus" || marker === "novus") return marker;
  // Fallback: package.json name lineage.
  const name = pkg.name ?? "";
  if (/satus/.test(name)) return "satus";
  if (/novus/.test(name)) return "novus";
  return null;
}

export async function detectStack(cwd: string = process.cwd()): Promise<Stack> {
  const evidence: string[] = [];
  const detected = new Set<StackKind>();
  const pkg = await readPackageJson(cwd);

  if (pkg) {
    const deps = allDeps(pkg);

    if (deps.next) {
      detected.add("nextjs");
      evidence.push(`package.json: next ${deps.next}`);
    }
    if (deps["react-router"] || deps["@react-router/dev"] || deps["@react-router/node"]) {
      detected.add("react-router");
      const v = deps["react-router"] ?? deps["@react-router/dev"] ?? deps["@react-router/node"];
      evidence.push(`package.json: react-router ${v}`);
    }
    if (deps["react-native"]) {
      detected.add("react-native");
      evidence.push(`package.json: react-native ${deps["react-native"]}`);
    }
    if (deps["@tauri-apps/api"] || deps["@tauri-apps/cli"]) {
      detected.add("tauri");
      evidence.push("package.json: @tauri-apps/* present");
    }
    // vite-react is a fallback — only claim it if there's no higher-priority match.
    if (deps.vite && deps.react && !detected.has("nextjs") && !detected.has("react-router")) {
      detected.add("vite-react");
      evidence.push(`package.json: vite ${deps.vite} + react`);
    }
  }

  // Config files reinforce or introduce signals.
  const nextCfg = hasAnyConfig(cwd, NEXT_CONFIG_NAMES);
  if (nextCfg) {
    detected.add("nextjs");
    evidence.push(`config: ${nextCfg}`);
  }
  const rrCfg = hasAnyConfig(cwd, RR_CONFIG_NAMES);
  if (rrCfg) {
    detected.add("react-router");
    evidence.push(`config: ${rrCfg}`);
  }
  const tauriCfg = hasAnyConfig(cwd, TAURI_CONFIG_NAMES);
  if (tauriCfg) {
    detected.add("tauri");
    evidence.push(`config: ${tauriCfg}`);
  }
  const viteCfg = hasAnyConfig(cwd, VITE_CONFIG_NAMES);
  if (viteCfg && !detected.has("nextjs") && !detected.has("react-router")) {
    detected.add("vite-react");
    evidence.push(`config: ${viteCfg}`);
  }

  // Folder-shape tiebreaker for cases with no package.json (template repos,
  // partial checkouts, etc.). Only consulted when we have nothing else.
  if (detected.size === 0) {
    if (existsSync(join(cwd, "app", "root.tsx"))) {
      detected.add("react-router");
      evidence.push("folder: app/root.tsx (RR7 entry)");
    } else if (
      existsSync(join(cwd, "app", "layout.tsx")) ||
      existsSync(join(cwd, "app", "page.tsx"))
    ) {
      detected.add("nextjs");
      evidence.push("folder: app/{layout,page}.tsx (Next.js App Router)");
    }
  }

  // Resolve primary kind. Priority order matches developer intent:
  // a Next.js project that happens to depend on react-router is still Next.js;
  // a mobile project with react-native wins over generic vite-react.
  const priority: StackKind[] = ["react-native", "tauri", "nextjs", "react-router", "vite-react"];
  const kind: StackKind = priority.find((k) => detected.has(k)) ?? "unknown";
  const alsoDetected = [...detected].filter((k) => k !== kind);

  return {
    kind,
    starter: detectStarter(pkg),
    alsoDetected,
    evidence,
    cwd,
  };
}

/** Convenience predicate used by skills that only need a yes/no on the primary kind. */
export function isStack(stack: Stack, kind: StackKind): boolean {
  return stack.kind === kind;
}

/**
 * Format a Stack for human consumption — used by skills that want to tell the
 * user what they detected before generating output.
 */
export function describeStack(stack: Stack): string {
  const parts: string[] = [];
  parts.push(stack.kind === "unknown" ? "no framework detected" : stack.kind);
  if (stack.starter) parts.push(`(${stack.starter} starter)`);
  if (stack.alsoDetected.length > 0) parts.push(`also: ${stack.alsoDetected.join(", ")}`);
  return parts.join(" ");
}
