#!/usr/bin/env bun
// Cross-platform desktop notification hook. Port of scripts/notify.sh.
//
// Invoked by the Notification hook with NOTIFICATION_MESSAGE in the env.
// Fires-and-forgets: never blocks, never fails the hook even if the
// underlying notifier is missing.
//
// - macOS:   osascript display-notification (argv to prevent AppleScript injection)
// - Linux:   notify-send
// - Windows: PowerShell System.Windows.Forms toast (the bash version has no
//            Windows path; this closes a Windows gap surfaced in Phase -1)

import { platform } from "node:process";

async function which(cmd: string): Promise<boolean> {
  // Use platform-native "command -v" on POSIX; "where" on Windows.
  const probe = platform === "win32" ? ["where", cmd] : ["sh", "-c", `command -v ${cmd}`];
  const proc = Bun.spawn(probe, { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

async function notifyMac(msg: string): Promise<void> {
  if (!(await which("osascript"))) return;
  // Pass the message via argv so AppleScript treats it as data, never code.
  const script =
    'on run argv\ndisplay notification (item 1 of argv) with title "Claude Code"\nend run';
  Bun.spawn(["osascript", "-e", script, "--", msg], { stdout: "ignore", stderr: "ignore" });
}

async function notifyLinux(msg: string): Promise<void> {
  if (!(await which("notify-send"))) return;
  Bun.spawn(["notify-send", "Claude Code", msg], { stdout: "ignore", stderr: "ignore" });
}

async function notifyWindows(msg: string): Promise<void> {
  // PowerShell balloon toast. Escape single quotes for the inlined PS literal.
  const safeMsg = msg.replace(/'/g, "''");
  const ps = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null;
$n = New-Object System.Windows.Forms.NotifyIcon;
$n.Icon = [System.Drawing.SystemIcons]::Information;
$n.Visible = $true;
$n.ShowBalloonTip(3000, 'Claude Code', '${safeMsg}', 'Info')`;
  Bun.spawn(["powershell", "-NoProfile", "-Command", ps], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

const msg = process.env.NOTIFICATION_MESSAGE ?? "";
if (msg) {
  if (platform === "darwin") await notifyMac(msg);
  else if (platform === "linux") await notifyLinux(msg);
  else if (platform === "win32") await notifyWindows(msg);
}
