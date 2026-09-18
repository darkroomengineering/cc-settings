import type { Profile } from "./light-profile.ts";

// --- Arg parsing ---------------------------------------------------------

export type InstallArgs = {
  rollback: string | true | null;
  uninstall: boolean;
  dryRun: boolean;
  status: boolean;
  help: boolean;
  sourceDir: string;
  interactive: boolean;
  migrateOnly: boolean;
  profile: Profile;
  autoUpdate: "on" | "off" | null;
  target: InstallTarget;
  fresh: boolean;
  /** TypeSafe API key from --typesafe-key=<key>; stored through the
   *  fast-jev-compaction plugin's sensitive option, never in a managed file. */
  typesafeKey: string | null;
  errors: string[];
};

export type InstallTarget = "auto" | "claude" | "codex" | "both";

export function includesTarget(
  target: Exclude<InstallTarget, "auto">,
  candidate: "claude" | "codex",
): boolean {
  return target === candidate || target === "both";
}
