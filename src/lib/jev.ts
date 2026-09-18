// Minimal client for TypeSafe's Jev model (System One): one `noul` question
// over a prompt returns a calibrated probability in [0, 1]. Used by hooks
// that must decide fast and fail open; nothing here throws.
//
// PRIVACY: the prompt text leaves the machine when this is called. Callers
// state that in their docs and only call with a key the user configured.

import { join } from "node:path";
import { readJsonOrNull } from "./json-io.ts";
import { CLAUDE_DIR } from "./platform.ts";

export const JEV_ENDPOINT = process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

/** TYPESAFE_API_KEY from the process env, else from the settings `env` block
 *  (the installer writes it there since 15.21.2). Undefined when unset. */
export async function typesafeKey(): Promise<string | undefined> {
  const fromEnv = process.env.TYPESAFE_API_KEY;
  if (fromEnv) return fromEnv;
  const settings = await readJsonOrNull(join(CLAUDE_DIR, "settings.json")).catch(() => null);
  const env = (settings as { env?: Record<string, unknown> } | null)?.env;
  const fromSettings = env?.TYPESAFE_API_KEY;
  return typeof fromSettings === "string" && fromSettings ? fromSettings : undefined;
}

export interface JevNoulOptions {
  key: string;
  prompt: string;
  /** The yes/no statement Jev scores against the prompt. */
  instructions: string;
  timeoutMs: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/** Probability that `instructions` holds for `prompt`, or null on any
 *  failure (network, timeout, non-2xx, malformed body). */
export async function jevNoul(opts: JevNoulOptions): Promise<number | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const resp = await fetchFn(JEV_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: { user_prompt: opts.prompt },
        questions: { q: { type: "noul", instructions: opts.instructions } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { answers?: { q?: { noul?: unknown } } };
    const p = body?.answers?.q?.noul;
    return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
  } catch {
    return null;
  }
}
