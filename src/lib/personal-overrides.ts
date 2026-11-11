import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PersonalOverrides, PersonalOverridesSchema } from "../schemas/personal-overrides.ts";
import { claudePath } from "./platform.ts";

export function readPersonalOverrides(claudeDir?: string): PersonalOverrides {
  const path = claudeDir
    ? join(claudeDir, "personal-overrides.json")
    : claudePath("personal-overrides.json");
  try {
    return PersonalOverridesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      console.error(
        "⚠ cc-settings: personal-overrides.json is unreadable or invalid; ignoring all personal overrides.",
      );
    }
    return {};
  }
}
