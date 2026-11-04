// Terminal color helpers — port of lib/colors.sh.
//
// Colors are resolved once at module load based on stdout TTY + COLORTERM/TERM,
// then frozen. Callers get a `palette` plus `info/success/warn/error` helpers.
//
// Brand palette matches the bash version (24-bit when the terminal supports it,
// ANSI fallback otherwise). NO_COLOR=1 disables all sequences.

const NO = process.env.NO_COLOR === "1";
const COLORS_FORCED = !NO && process.stdout.isTTY;
const COLORTERM = (process.env.COLORTERM ?? "").toLowerCase();
const TERM = (process.env.TERM ?? "").toLowerCase();
const TRUECOLOR = COLORTERM === "truecolor" || COLORTERM === "24bit" || TERM.includes("256color");

function seq(trueColor: string, basic: string): string {
  if (!COLORS_FORCED) return "";
  return TRUECOLOR ? trueColor : basic;
}

/** Raw brand escape sequences, ungated — the single source of truth for the
 *  color VALUES. `palette` below wraps them in the TTY/NO_COLOR gate; the
 *  statusline imports these directly (Claude Code pipes its stdout, so the
 *  TTY gate would strip everything) and applies its own NO_COLOR-only gate. */
export const RAW_SEQUENCES = {
  red: "\x1b[38;2;227;6;19m",
  green: "\x1b[38;2;0;255;136m",
  yellow: "\x1b[38;2;255;180;0m",
  blue: "\x1b[38;2;0;112;243m",
  magenta: "\x1b[38;2;255;0;128m",
  cyan: "\x1b[38;2;121;40;202m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

export const palette = {
  red: seq(RAW_SEQUENCES.red, "\x1b[0;31m"),
  green: seq(RAW_SEQUENCES.green, "\x1b[0;32m"),
  yellow: seq(RAW_SEQUENCES.yellow, "\x1b[0;33m"),
  blue: seq(RAW_SEQUENCES.blue, "\x1b[0;34m"),
  magenta: seq(RAW_SEQUENCES.magenta, "\x1b[0;35m"),
  cyan: seq(RAW_SEQUENCES.cyan, "\x1b[0;36m"),
  bold: COLORS_FORCED ? RAW_SEQUENCES.bold : "",
  dim: COLORS_FORCED ? RAW_SEQUENCES.dim : "",
  reset: COLORS_FORCED ? RAW_SEQUENCES.reset : "",
} as const;

function color(s: string, ansi: string): string {
  if (!ansi) return s;
  return `${ansi}${s}${palette.reset}`;
}

// --- Live progress --------------------------------------------------------
//
// One spinner line at a time, redrawn in place, only on a TTY. Every printer
// below clears it first, so a warning printed mid-step lands on its own line
// and the spinner redraws under it. Without a TTY (auto-update log, CI, piped
// tests) nothing uses "\r": a step prints a start line and, when slow, a
// duration line.

const LIVE = process.stdout.isTTY === true && process.env.CI !== "true";
const FRAMES = ["|", "/", "-", "\\"] as const;
let live: { label: string; startedAt: number; frame: number } | null = null;

function clearLive(): void {
  if (live) process.stdout.write("\r\x1b[2K");
}

function drawLive(): void {
  if (!live) return;
  const seconds = Math.floor((Date.now() - live.startedAt) / 1000);
  const frame = FRAMES[live.frame++ % FRAMES.length];
  process.stdout.write(
    `\r\x1b[2K  ${color(frame ?? "|", palette.cyan)} ${live.label} ${palette.dim}${seconds}s${palette.reset}`,
  );
}

function out(line: string): void {
  clearLive();
  console.log(line);
}

let phaseTotal = 0;
let phaseIndex = 0;

/** Number the phases that follow ("[2/6] ..."). Zero turns numbering off. */
export function startPhases(total: number): void {
  phaseTotal = total;
  phaseIndex = 0;
}

export function phase(label: string): void {
  phaseIndex++;
  const counter =
    phaseTotal > 0
      ? `${palette.dim}[${Math.min(phaseIndex, phaseTotal)}/${phaseTotal}]${palette.reset} `
      : "";
  out(`${color("●", palette.blue)} ${counter}${palette.bold}${label}${palette.reset}`);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Run one slow step under a live spinner with elapsed seconds. On success the
 * spinner becomes "✓ label (Ns)"; on failure it is cleared and the error
 * propagates for the caller to report. Nested calls run plainly inside the
 * outer spinner.
 */
export async function withProgress<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (live) return work();
  const startedAt = Date.now();
  if (!LIVE) {
    console.log(`  ${color("→", palette.cyan)} ${label}...`);
    const result = await work();
    const elapsed = Date.now() - startedAt;
    if (elapsed > 2000)
      console.log(`  ${color("→", palette.cyan)} ...took ${formatSeconds(elapsed)}`);
    return result;
  }
  live = { label, startedAt, frame: 0 };
  drawLive();
  const timer = setInterval(drawLive, 100);
  try {
    const result = await work();
    clearInterval(timer);
    clearLive();
    live = null;
    console.log(
      `  ${color("✓", palette.green)} ${label} ${palette.dim}${formatSeconds(Date.now() - startedAt)}${palette.reset}`,
    );
    return result;
  } finally {
    clearInterval(timer);
    clearLive();
    live = null;
  }
}

// --- Styled output --------------------------------------------------------

export function info(...parts: unknown[]): void {
  out(`${color("ℹ", palette.blue)} ${parts.join(" ")}`);
}

export function success(...parts: unknown[]): void {
  out(`${color("✓", palette.green)} ${parts.join(" ")}`);
}

export function warn(...parts: unknown[]): void {
  out(`${color("⚠", palette.yellow)} ${parts.join(" ")}`);
}

export function error(...parts: unknown[]): void {
  clearLive();
  console.error(`${color("✗", palette.red)} ${parts.join(" ")}`);
}

export function debug(...parts: unknown[]): void {
  if (process.env.DEBUG === "1") {
    out(`${color("○", palette.dim)} ${parts.join(" ")}`);
  }
}

export function progressOk(msg: string): void {
  out(`  ${color("✓", palette.green)} ${msg}`);
}

export function progressWarn(msg: string): void {
  out(`  ${color("⚠", palette.yellow)} ${msg}`);
}

export function progressFail(msg: string): void {
  out(`  ${color("✗", palette.red)} ${msg}`);
}

export function progressArrow(msg: string): void {
  out(`  ${color("→", palette.cyan)} ${msg}`);
}

// --- Box drawing (setup banner + MCP status) ------------------------------

export function boxStart(title = ""): void {
  const rule = `${palette.bold}+-------------------------------------------+${palette.reset}`;
  console.log(rule);
  if (title) {
    console.log(`${palette.bold}| ${title.padEnd(41)} |${palette.reset}`);
    console.log(rule);
  }
}

export function boxLine(status: "ok" | "warn" | "fail" | "none", text: string): void {
  const symbol =
    status === "ok"
      ? color("✓", palette.green)
      : status === "warn"
        ? color("⚠", palette.yellow)
        : status === "fail"
          ? color("✗", palette.red)
          : " ";
  console.log(`| ${symbol} ${text.padEnd(38)} |`);
}

export function boxEnd(): void {
  console.log(`${palette.bold}+-------------------------------------------+${palette.reset}`);
}

export function showBanner(version: string, product: string): void {
  const cyan = palette.cyan;
  const bold = palette.bold;
  const reset = palette.reset;
  const line = (text: string) => `| ${text.padEnd(42)} |`;
  console.log("");
  console.log(`${bold}${cyan}+============================================+${reset}`);
  console.log(`${bold}${cyan}${line(`Darkroom ${product} Setup v${version}`)}${reset}`);
  console.log(`${bold}${cyan}${line("Batteries Included - Auto-Install")}${reset}`);
  console.log(`${bold}${cyan}${line("(Idempotent - safe to re-run)")}${reset}`);
  console.log(`${bold}${cyan}+============================================+${reset}`);
  console.log("");
}
