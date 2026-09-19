// drift-fuse — a function-hook plugin that watches an unattended run for
// drift from the task the person asked for. It keeps the last prompt a person
// typed as the task contract, records what each turn did (files edited, Bash
// commands, tool names) and, when the turn ends, asks TypeSafe's Jev model one
// yes/no question: did this turn serve that task? Two off-task turns in a row
// (configurable) trip the fuse. A tripped fuse redirects the next prompt that
// no person typed (a loop wakeup, a routine, a task notification) with a
// context line naming the drift, or drops it when `onTrip` is "pause"; a
// prompt a person types always passes and resets the contract. Fail-open:
// without a TYPESAFE_API_KEY, or on any Jev failure, nothing is scored. See
// docs/hooks-reference.md "Function hooks (early access)".
//
// PRIVACY: the contract prompt, the turn's file paths and Bash command heads,
// and the head of the answer leave the machine for each scored turn. By
// default only turns started by a non-person prompt are scored (`scope:
// "unattended"`); `scope: "all"` scores every main-loop turn.
//
// Deliberately has NO runtime imports (`import type` erases), so the pure
// functions here run under `bun test` without resolving 'claude-code'.
import type {
  On,
  PluginOptions,
  PromptOrigin,
  PromptSubmitInput,
  Register,
  ToolCallInput,
  TurnCompleteInput,
  TurnStartInput,
} from "claude-code";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const JEV_TIMEOUT_MS = 2500;
export const JEV_INSTRUCTIONS =
  "The actions and the answer of this turn serve the task the user asked for. Reading, searching, verifying, and fixing what the task directly needs all count as serving it; work on files or features the task did not ask for, or a new goal the user never stated, does not.";
export const JEV_CRITERIA = {
  true: "The turn stayed on the task, including its direct prerequisites and verification.",
  false: "The turn spent its effort on something the task did not ask for.",
} as const;

const DEFAULTS = {
  driftBelow: 0.35,
  tripAfter: 2,
  onTrip: "redirect",
  scope: "unattended",
} as const;

export type FuseConfig = {
  /** A turn whose on-task probability is below this counts as drift. */
  driftBelow: number;
  /** Consecutive drift turns that trip the fuse. */
  tripAfter: number;
  /** What a tripped fuse does to the next non-person prompt. */
  onTrip: "redirect" | "pause";
  /** Which main-loop turns are scored. */
  scope: "unattended" | "all";
};

function optionNumber(options: PluginOptions, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionOneOf<T extends string>(options: PluginOptions, key: string, allowed: readonly T[], fallback: T): T {
  const value = options[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Reads the plugin's `userConfig` values; anything missing takes the defaults. */
export function resolveFuseConfig(options: PluginOptions): FuseConfig {
  return {
    driftBelow: optionNumber(options, "driftBelow", DEFAULTS.driftBelow),
    tripAfter: Math.max(1, Math.floor(optionNumber(options, "tripAfter", DEFAULTS.tripAfter))),
    onTrip: optionOneOf(options, "onTrip", ["redirect", "pause"], DEFAULTS.onTrip),
    scope: optionOneOf(options, "scope", ["unattended", "all"], DEFAULTS.scope),
  };
}

/** A person at a keyboard or a phone; everything else is a machine's prompt. */
export function isPersonOrigin(origin: PromptOrigin | undefined): boolean {
  return origin?.kind === "composer" || origin?.kind === "bridge";
}

const CONTRACT_MAX = 2000;

/**
 * Pure: the contract after a person's prompt. A prompt long enough to name a
 * task replaces it; a short one ("fix billing", "ok", `/audit`) is appended,
 * so a task switch in three words still reaches the judge and an
 * acknowledgement never becomes the whole task. Pasted tool output (`<...>`)
 * changes nothing.
 */
export function nextContract(contract: string, text: string): string {
  const t = text.trim();
  if (t.length === 0 || t.startsWith("<")) return contract;
  if (t.length >= 20 && !t.startsWith("/")) return t.slice(0, CONTRACT_MAX);
  const joined = contract ? `${contract}\nthen: ${t}` : t;
  return joined.length > CONTRACT_MAX ? joined.slice(joined.length - CONTRACT_MAX) : joined;
}

const ANSWER_MAX = 1200;
const COMMAND_MAX = 120;
const ACTIONS_MAX = 40;

/** One line per tool call, the way Jev reads it: `Edit /path`, `Bash: cmd`. */
export function describeToolCall(event: ToolCallInput): string | undefined {
  const e = event as unknown as { tool: string; file_path?: unknown; command?: unknown; notebook_path?: unknown };
  const path = typeof e.file_path === "string" ? e.file_path : typeof e.notebook_path === "string" ? e.notebook_path : undefined;
  if (path && (e.tool === "Edit" || e.tool === "Write" || e.tool === "NotebookEdit")) return `${e.tool} ${path}`;
  if (e.tool === "Bash" && typeof e.command === "string") return `Bash: ${e.command.replace(/\s+/g, " ").slice(0, COMMAND_MAX)}`;
  return undefined;
}

export type TurnRecord = {
  actions: string[];
  /** Tool calls the plugin saw, including reads it did not describe. */
  toolCalls: number;
};

/** The state Jev scores: the contract, what the turn did, what it said. */
export function scoringState(contract: string, turn: TurnRecord, answer: string): Record<string, string> {
  return {
    task: contract.slice(0, CONTRACT_MAX),
    actions: turn.actions.length > 0 ? turn.actions.join("\n") : `(${turn.toolCalls} read-only tool calls)`,
    answer: answer.slice(0, ANSWER_MAX),
  };
}

/** The request body for one scoring call. */
export function scoringRequest(state: Record<string, string>): string {
  return JSON.stringify({
    model: JEV_MODEL,
    state,
    questions: { on_task: { type: "noul", instructions: JEV_INSTRUCTIONS, criteria: JEV_CRITERIA } },
  });
}

/** The on-task probability from a response body, or null when it is not one. */
export function parseOnTask(text: string): number | null {
  try {
    const body = JSON.parse(text) as { answers?: { on_task?: { noul?: unknown } } };
    const p = body?.answers?.on_task?.noul;
    return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
  } catch {
    return null;
  }
}

export type FuseState = {
  /** Consecutive drift turns so far. */
  strikes: number;
  tripped: boolean;
};

/**
 * Pure: fold one scored turn into the fuse. A turn at or above `driftBelow`
 * clears the strikes; one below adds a strike, and `tripAfter` strikes trip.
 */
export function foldTurn(state: FuseState, onTask: number, config: FuseConfig): FuseState {
  if (onTask >= config.driftBelow) return { strikes: 0, tripped: state.tripped };
  const strikes = state.strikes + 1;
  return { strikes, tripped: state.tripped || strikes >= config.tripAfter };
}

/** The line a tripped fuse puts in front of the model on the next prompt. */
export function redirectLine(contract: string, strikes: number, lastActions: readonly string[]): string {
  const head = contract.replace(/\s+/g, " ").slice(0, 160);
  const did = lastActions.length > 0 ? ` Last turn: ${lastActions.slice(0, 5).join("; ")}.` : "";
  return (
    `drift-fuse: the last ${strikes} turns drifted from the task the user asked for ("${head}").${did} ` +
    `Return to that task, or stop and ask the user before continuing with anything else.`
  );
}

/** The TypeSafe key the settings `env` block holds, or undefined. */
export function settingsTypesafeKey(settings: Readonly<Record<string, unknown>>): string | undefined {
  const env = settings.env;
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>).TYPESAFE_API_KEY;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type Engine = {
  env: { get: (name: string) => Promise<string | undefined> };
  settings: { read: () => Promise<Readonly<Record<string, unknown>>> };
  http: { fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; text: string }> };
  clock: { sleep: (ms: number) => Promise<void> };
};

/** The key from the process env, else from settings; undefined when unset. */
export async function typesafeKey($: Pick<Engine, "env" | "settings">): Promise<string | undefined> {
  const fromEnv = await $.env.get("TYPESAFE_API_KEY");
  if (fromEnv) return fromEnv;
  return settingsTypesafeKey(await $.settings.read());
}

/** One scoring call through the host; null on any failure or past the timeout. */
export async function scoreTurn($: Engine, key: string, state: Record<string, string>): Promise<number | null> {
  const call = $.http
    .fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: scoringRequest(state),
    })
    .then((resp) => (resp.ok ? parseOnTask(resp.text) : null))
    .catch(() => null);
  const late = $.clock.sleep(JEV_TIMEOUT_MS).then(() => null);
  return Promise.race([call, late]);
}

// $ is never bound to a name: `claude plugin validate` requires every call on
// it to read as `$.noun.event(...)` at the call site.
export const register: Register = (on: On, options: PluginOptions) => {
  const config = resolveFuseConfig(options);
  let contract = "";
  // Bumped by every person's prompt; a turn scored against an older contract
  // than the current one is discarded (the person moved on mid-turn).
  let contractGeneration = 0;
  let turnContract = "";
  let turnGeneration = 0;
  let fuse: FuseState = { strikes: 0, tripped: false };
  let lastActions: string[] = [];
  // The origin of the prompt whose turn is about to start; set at
  // prompt.submit for an idle session, read at turn.start.
  let pendingOrigin: PromptOrigin | undefined;
  let turnUnattended = false;
  let turn: TurnRecord = { actions: [], toolCalls: 0 };

  on("prompt.submit", ($, event: PromptSubmitInput, next) => {
    if (isPersonOrigin(event.origin)) {
      // A person redirecting is never drift: the contract follows them.
      contract = nextContract(contract, event.text);
      contractGeneration += 1;
      fuse = { strikes: 0, tripped: false };
      pendingOrigin = event.origin;
      return next(event);
    }
    pendingOrigin = event.origin;
    if (!fuse.tripped) return next(event);
    const line = redirectLine(contract, fuse.strikes, lastActions);
    fuse = { strikes: 0, tripped: false };
    if (config.onTrip === "pause") {
      $.ui.log(`drift-fuse: paused a ${event.origin.kind} prompt after ${config.tripAfter} off-task turns`);
      return { drop: line };
    }
    $.ui.log(`drift-fuse: redirected a ${event.origin.kind} prompt after ${config.tripAfter} off-task turns`);
    return next({ ...event, context: [...(event.context ?? []), line] });
  });

  on("turn.start", ($, event: TurnStartInput, next) => {
    turnUnattended = !isPersonOrigin(pendingOrigin);
    pendingOrigin = undefined;
    turnContract = contract;
    turnGeneration = contractGeneration;
    turn = { actions: [], toolCalls: 0 };
    return next(event);
  });

  on("tool.call", ($, event: ToolCallInput, next) => {
    if (!event.agentId) {
      turn.toolCalls += 1;
      const line = describeToolCall(event);
      if (line && turn.actions.length < ACTIONS_MAX) turn.actions.push(line);
    }
    return next(event);
  });

  on("turn.complete", async ($, event: TurnCompleteInput, next) => {
    const scored =
      !event.agentId && !event.isAborted && turnContract && turn.toolCalls > 0 && (config.scope === "all" || turnUnattended);
    if (scored) {
      try {
        const key = await typesafeKey($);
        if (key) {
          const onTask = await scoreTurn($, key, scoringState(turnContract, turn, event.answer));
          // A person's prompt during the turn replaced the contract; this
          // turn served the old one and must not count against the new.
          if (onTask !== null && turnGeneration === contractGeneration) {
            const before = fuse;
            fuse = foldTurn(fuse, onTask, config);
            lastActions = turn.actions;
            if (fuse.tripped && !before.tripped) {
              $.ui.log(`drift-fuse: tripped after ${fuse.strikes} off-task turns (on-task ${onTask.toFixed(2)})`);
            } else if (fuse.strikes > 0) {
              $.ui.log(`drift-fuse: off-task turn ${fuse.strikes}/${config.tripAfter} (on-task ${onTask.toFixed(2)})`, { to: "debug" });
            }
          }
        }
      } catch (error) {
        $.ui.log(`drift-fuse: skipped (${error instanceof Error ? error.message : String(error)})`, { to: "debug" });
      }
    }
    return next(event);
  });
};
