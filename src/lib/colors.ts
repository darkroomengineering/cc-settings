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

export const palette = {
  red: seq("\x1b[38;2;227;6;19m", "\x1b[0;31m"),
  green: seq("\x1b[38;2;0;255;136m", "\x1b[0;32m"),
  yellow: seq("\x1b[38;2;255;180;0m", "\x1b[0;33m"),
  blue: seq("\x1b[38;2;0;112;243m", "\x1b[0;34m"),
  magenta: seq("\x1b[38;2;255;0;128m", "\x1b[0;35m"),
  cyan: seq("\x1b[38;2;121;40;202m", "\x1b[0;36m"),
  bold: COLORS_FORCED ? "\x1b[1m" : "",
  dim: COLORS_FORCED ? "\x1b[2m" : "",
  reset: COLORS_FORCED ? "\x1b[0m" : "",
} as const;

export function color(s: string, ansi: string): string {
  if (!ansi) return s;
  return `${ansi}${s}${palette.reset}`;
}

// --- Styled output --------------------------------------------------------

export function info(...parts: unknown[]): void {
  console.log(`${color("ℹ", palette.blue)} ${parts.join(" ")}`);
}

export function success(...parts: unknown[]): void {
  console.log(`${color("✓", palette.green)} ${parts.join(" ")}`);
}

export function warn(...parts: unknown[]): void {
  console.log(`${color("⚠", palette.yellow)} ${parts.join(" ")}`);
}

export function error(...parts: unknown[]): void {
  console.error(`${color("✗", palette.red)} ${parts.join(" ")}`);
}

export function debug(...parts: unknown[]): void {
  if (process.env.DEBUG === "1") {
    console.log(`${color("○", palette.dim)} ${parts.join(" ")}`);
  }
}

export function progressOk(msg: string): void {
  console.log(`  ${color("✓", palette.green)} ${msg}`);
}

export function progressWarn(msg: string): void {
  console.log(`  ${color("⚠", palette.yellow)} ${msg}`);
}

export function progressFail(msg: string): void {
  console.log(`  ${color("✗", palette.red)} ${msg}`);
}

export function progressArrow(msg: string): void {
  console.log(`  ${color("→", palette.cyan)} ${msg}`);
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

export function showBanner(version = "8.0"): void {
  const cyan = palette.cyan;
  const bold = palette.bold;
  const reset = palette.reset;
  console.log("");
  console.log(`${bold}${cyan}+============================================+${reset}`);
  console.log(`${bold}${cyan}|   Darkroom Claude Code Setup v${version}         |${reset}`);
  console.log(`${bold}${cyan}|   Batteries Included - Auto-Install       |${reset}`);
  console.log(`${bold}${cyan}|   (Idempotent - safe to re-run)           |${reset}`);
  console.log(`${bold}${cyan}+============================================+${reset}`);
  console.log("");
}
