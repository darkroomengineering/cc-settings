// Runs spawn-cap payloads in a fresh process for tests/spawn-cap.test.ts.
// platform.ts and hook-runtime.ts fix the state dir at import time, and
// `bun test` shares those modules across test files, so only a new process
// honors the CC_SETTINGS_HOME the test sets.
//
// stdin: {"via":"main"|"runHook"|"dispatch","payloads":["<raw payload>", …]}
// stdout: {"tmp":"<state dir>","steps":[{"asks":[…],"errors":[…],"threw":null|"<message>"}, …]}

import { HANDLERS, runHandlers } from "../../src/hooks/dispatch.ts";
import { main } from "../../src/hooks/spawn-cap.ts";
import { captureIO, runHook } from "../../src/lib/hook-runtime.ts";
import { claudePath } from "../../src/lib/platform.ts";

interface Request {
  via: "main" | "runHook" | "dispatch";
  payloads: string[];
}

interface Step {
  asks: string[];
  errors: string[];
  threw: string | null;
}

async function run(via: Request["via"], raw: string): Promise<Step> {
  if (via === "dispatch") {
    const handler = HANDLERS.PreToolUse.find((h) => h.name === "spawn-cap");
    if (!handler) throw new Error("spawn-cap is not a PreToolUse handler");
    const result = await runHandlers(raw, [handler]);
    return { asks: result.asks, errors: result.errors, threw: null };
  }
  const io = captureIO(raw);
  try {
    await (via === "runHook" ? runHook(() => main(io)) : main(io));
    return { asks: io.asks, errors: [], threw: null };
  } catch (err) {
    return { asks: io.asks, errors: [], threw: err instanceof Error ? err.message : String(err) };
  }
}

const request = JSON.parse(await Bun.stdin.text()) as Request;
const steps: Step[] = [];
for (const raw of request.payloads) steps.push(await run(request.via, raw));
console.log(JSON.stringify({ tmp: claudePath("tmp"), steps }));
