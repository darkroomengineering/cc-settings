// compaction-trigger — a small function-hook plugin that asks Claude Code to
// compact the session once the live context passes a token threshold, tied to
// cc-settings' ~150K working-context ceiling rather than upstream verbatim
// compaction plugins' percentage-of-window trigger (which fires far too often
// on a 200K+ window model). Before requesting, it copies a rotated
// TYPESAFE_API_KEY from settings into the process env so the verbatim plugin
// does not 401 for the rest of the session. See docs/hooks-reference.md
// "Function hooks (early access)".
//
// Deliberately has NO runtime imports: `import type` erases at compile time,
// so this module can be unit-tested under `bun test` without resolving the
// 'claude-code' module specifier (it exists only as ambient types, generated
// by `/plugin-types`, never published to a registry bun could fetch).
import type { On, PluginOptions, Register, TurnCompleteInput } from "claude-code";

const DEFAULTS = {
  compactAtTokens: 150_000,
  minTurnsBetween: 3,
} as const;

export type TriggerConfig = {
  compactAtTokens: number;
  minTurnsBetween: number;
};

function optionNumber(options: PluginOptions, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads the plugin's `userConfig` values; anything missing takes the defaults. */
export function resolveTriggerConfig(options: PluginOptions): TriggerConfig {
  return {
    compactAtTokens: optionNumber(options, "compactAtTokens", DEFAULTS.compactAtTokens),
    minTurnsBetween: optionNumber(options, "minTurnsBetween", DEFAULTS.minTurnsBetween),
  };
}

export type ShouldRequestInput = {
  /** `context.tokens` from `$.session.usage()`; absent before the first API
   *  response of a live window. */
  tokens: number | undefined;
  compactAtTokens: number;
  /** Turns elapsed (inclusive of the current one) since the last compaction
   *  this plugin requested. */
  turnsSince: number;
  minTurnsBetween: number;
  /** True while a compaction this plugin requested is still in flight. */
  compacting: boolean;
};

/**
 * Pure decision: should `turn.complete` ask `$.session.compact()` to run now?
 * No engine access, so it is exercised directly in tests without a fake `$`.
 */
export function shouldRequest(input: ShouldRequestInput): boolean {
  if (input.compacting) return false;
  if (input.turnsSince < input.minTurnsBetween) return false;
  if (typeof input.tokens !== "number") return false;
  return input.tokens >= input.compactAtTokens;
}

/** The TypeSafe key the settings `env` block holds, or undefined. */
export function settingsTypesafeKey(settings: Readonly<Record<string, unknown>>): string | undefined {
  const env = settings.env;
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>).TYPESAFE_API_KEY;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Copies a rotated TypeSafe key from settings into the process env before a
 * compaction. The verbatim plugin reads `$.env.get("TYPESAFE_API_KEY")` before
 * it reads settings, so a session started before a key rotation kept sending
 * the stale key and fell back to the built-in summary on every 401.
 * Returns true when the env was updated.
 */
export async function syncTypesafeKey($: {
  env: { get: (name: string) => Promise<string | undefined>; set: (name: string, value: string | undefined) => Promise<void> };
  settings: { read: () => Promise<Readonly<Record<string, unknown>>> };
}): Promise<boolean> {
  const fromSettings = settingsTypesafeKey(await $.settings.read());
  if (!fromSettings) return false;
  const fromEnv = await $.env.get("TYPESAFE_API_KEY");
  if (fromEnv === fromSettings) return false;
  await $.env.set("TYPESAFE_API_KEY", fromSettings);
  return true;
}

// $ is never bound to a name: `claude plugin validate` requires every call on
// it to read as `$.noun.event(...)` at the call site, so every use below goes
// straight through a `$` parameter.
export const register: Register = (on: On, options: PluginOptions) => {
  const config = resolveTriggerConfig(options);
  let compacting = false;
  let turnsSinceCompaction = 0;

  on("turn.complete", async ($, event: TurnCompleteInput, next) => {
    turnsSinceCompaction += 1;
    try {
      const { context } = await $.session.usage();
      const request = shouldRequest({
        tokens: context.tokens,
        compactAtTokens: config.compactAtTokens,
        turnsSince: turnsSinceCompaction,
        minTurnsBetween: config.minTurnsBetween,
        compacting,
      });
      if (request) {
        compacting = true;
        try {
          if (await syncTypesafeKey($)) $.ui.log("compaction-trigger: refreshed TYPESAFE_API_KEY from settings");
        } catch (error) {
          $.ui.log(
            `compaction-trigger: key sync skipped (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        const result = await $.session.compact();
        if (result.skip) {
          $.ui.log(`compaction-trigger: skipped: ${result.skip}`);
        } else {
          $.ui.log(`compaction-trigger: requested at ${context.tokens} tokens`);
        }
        turnsSinceCompaction = 0;
      }
    } catch (error) {
      $.ui.log(
        `compaction-trigger: skipped (${error instanceof Error ? error.message : String(error)})`,
      );
    } finally {
      compacting = false;
    }
    return next(event);
  });
};
