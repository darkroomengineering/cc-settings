import { captureIO } from "../../src/lib/hook-runtime.ts";

// Keep the host's app bundle out of missing-binary tests, even on Programa users' Macs.
const which = Bun.which;
Bun.which = (command, options) =>
  command === "/Applications/Programa.app/Contents/Resources/bin/programa"
    ? null
    : which(command, options);

const { main } = await import("../../src/hooks/session-worktrees.ts");
const payloads: unknown = JSON.parse(await Bun.stdin.text());
if (!Array.isArray(payloads)) throw new Error("Expected payload array");
const steps: { output: string[]; errors: string[]; cwd?: string }[] = [];
const print = console.log;
const error = console.error;
try {
  for (const payload of payloads) {
    const step = { output: [] as string[], errors: [] as string[] };
    console.log = (...args: unknown[]) => step.output.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => step.errors.push(args.map(String).join(" "));
    await main(captureIO(typeof payload === "string" ? payload : JSON.stringify(payload)));
    if (process.env.CAPTURE_CWD === "1") Object.assign(step, { cwd: process.cwd() });
    steps.push(step);
  }
} finally {
  console.log = print;
  console.error = error;
}
print(JSON.stringify(steps));
