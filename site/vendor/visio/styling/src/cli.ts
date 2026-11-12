import path from "node:path";

import { formatDiagnostic } from "./compiler/errors.ts";
import { formatReport } from "./lint/report.ts";
import { Project } from "./project.ts";

interface Args {
  command: string;
  root: string;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { command: argv[0] ?? "check", root: process.cwd() };
  const rest = argv.slice(1).values();

  for (const a of rest) {
    // Undocumented: tests point the check at a fixture.
    if (a === "--root") {
      args.root = path.resolve(rest.next().value ?? "");
    } else if (a === "--help" || a === "-h") {
      args.command = "help";
    } else {
      return { error: `unknown option "${a}"` };
    }
  }

  return args;
}

const HELP = `visio-styling check

  Compiles src/**/*.{ts,tsx} against src/styles/tokens.ts and prints the
  errors and the style report. Exit 1 on any error or finding.
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if ("error" in args) {
    process.stderr.write(`${args.error}\n${HELP}`);

    return 2;
  }

  if (args.command === "help") {
    process.stdout.write(HELP);

    return 0;
  }

  if (args.command !== "check") {
    process.stderr.write(`unknown command "${args.command}"\n${HELP}`);

    return 2;
  }

  const project = new Project({ root: args.root });
  await project.loadTokens();
  // The font checks the build runs before it subsets; the check subsets nothing.
  project.checkFonts();
  const diagnostics = await project.scan();
  const errors = diagnostics.filter((d) => d.severity === "error");
  // Warnings are in the report as findings.
  const report = project.report();

  for (const d of errors) {
    process.stdout.write(`error ${formatDiagnostic(d)}\n`);
  }

  process.stdout.write(
    `${formatReport(report, "each fails this check and the build")}\n`
  );

  return errors.length || report.findings.length ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
