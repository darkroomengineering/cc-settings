#!/usr/bin/env bun
// Prototype leaf-script port: notify.sh → notify.ts.
// Compiled via `bun build --compile` to prove out binary size + cold-start
// budget for Phase 4's `cc-hook` bundled binary.
//
// Parity with scripts/notify.sh:
//   - macOS: osascript display-notification (argv to prevent injection)
//   - Linux: notify-send
//   - Windows: (stub; unimplemented in bash today)
// Reads NOTIFICATION_MESSAGE from env, same contract as the bash version.

import { platform } from "node:process";

async function which(cmd: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-c", `command -v ${cmd}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

async function notifyMac(msg: string) {
  if (!(await which("osascript"))) return;
  const script =
    'on run argv\ndisplay notification (item 1 of argv) with title "Claude Code"\nend run';
  Bun.spawn(["osascript", "-e", script, "--", msg], { stdout: "ignore", stderr: "ignore" });
}

async function notifyLinux(msg: string) {
  if (!(await which("notify-send"))) return;
  Bun.spawn(["notify-send", "Claude Code", msg], { stdout: "ignore", stderr: "ignore" });
}

async function notifyWindows(msg: string) {
  // PowerShell toast — placeholder; bash version is also non-functional on Windows today.
  const ps = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null;
$n = New-Object System.Windows.Forms.NotifyIcon;
$n.Icon = [System.Drawing.SystemIcons]::Information;
$n.Visible = $true;
$n.ShowBalloonTip(3000, 'Claude Code', '${msg.replace(/'/g, "''")}', 'Info')`;
  Bun.spawn(["powershell", "-NoProfile", "-Command", ps], { stdout: "ignore", stderr: "ignore" });
}

const msg = process.env.NOTIFICATION_MESSAGE ?? "";
if (msg) {
  if (platform === "darwin") await notifyMac(msg);
  else if (platform === "linux") await notifyLinux(msg);
  else if (platform === "win32") await notifyWindows(msg);
}
