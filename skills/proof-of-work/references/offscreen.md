# Offscreen: run a Mac app without touching the user's screen

`offscreen` runs a native Mac app on a virtual display and drives it without
moving the user's cursor, typing on their keyboard, or changing the frontmost
app. Use it for the visual proof of a macOS app change, and for any build,
launch, and check loop that would otherwise take over the user's Mac.

```bash
OFFSCREEN="${CODEX_HOME:-$HOME/.codex}/darkroom/source/skills/proof-of-work/scripts/offscreen.sh"
[ -f "$OFFSCREEN" ] || OFFSCREEN="$HOME/.claude/skills/proof-of-work/scripts/offscreen.sh"
bash "$OFFSCREEN" status
```

The script compiles `offscreen.m` with clang on first use (Xcode or the
Command Line Tools) and caches the binary in `~/.cache/cc-settings/`.

## Before the first run

`status` prints the virtual display, the cursor position, the frontmost app,
and two permissions. Both must read `granted` for the terminal app the agent
runs in:

- **Accessibility**, to move windows and press controls.
- **Screen Recording**, to capture windows.

If either reads `missing`, stop and ask the user to grant it in System
Settings > Privacy & Security. Never drive the app another way instead.

## The loop

Each shell call is a fresh process, so keep the app pid in a file, not a
variable, and stop the display with `stop`.

```bash
nohup bash "$OFFSCREEN" display >/dev/null 2>&1 &   # stays up until `stop`
sleep 3
bash "$OFFSCREEN" launch path/to/Debug/App.app > /tmp/app.pid
APP_PID=$(cat /tmp/app.pid)
bash "$OFFSCREEN" tree "$APP_PID" 8      # find controls by title, description or identifier
bash "$OFFSCREEN" press "$APP_PID" "New Message"
bash "$OFFSCREEN" set "$APP_PID" "search-field" "hello"
bash "$OFFSCREEN" menu "$APP_PID" File "New Window"
bash "$OFFSCREEN" park "$APP_PID"        # after anything that opens a window
bash "$OFFSCREEN" type "$APP_PID" "some text"
bash "$OFFSCREEN" key "$APP_PID" return
bash "$OFFSCREEN" shot "$APP_PID" /path/to/proof.png
bash "$OFFSCREEN" close "$APP_PID"       # a window's close button; answer the sheet with `press`
bash "$OFFSCREEN" stop                   # quits every app `launch` opened, then removes the display
```

- `display` creates a 1920x1200 monitor (`--size WxH` to change it) and places
  it below and to the left of the real displays. It lasts as long as the
  process runs.
- `launch` opens a new instance without activating it and without restoring
  windows from an earlier run, moves its windows onto the virtual display, and
  prints the pid. If the app activates itself anyway,
  `launch` gives focus back to the app that had it. The app's environment
  carries `CC_OFFSCREEN=1`, so a dev build can skip activating itself.
- `park <pid>` moves windows that opened later onto the virtual display.
- `press`, `set`, `menu` and `close` act through the Accessibility API. `type` and `key`
  post keystrokes to the app's process only, never to the system event stream.
- `shot` captures the app's front window, wherever it is.

Open the screenshot and look at it before reporting. The proof is the image,
not the exit code.

## Rules

- **Never send real input.** Do not use `cliclick`, `osascript` keystrokes or
  clicks, `CGEventPost`, or computer use against a running app. Drive the app
  through `press`, `set`, `menu`, `close`, `type` and `key`.
- **XCUITest and UI test targets still move the real cursor** and take focus.
  Run them only when the user says the machine is free, and say so in the proof
  report.
- **Launch dev builds,** never the user's installed copy. Use a scheme or
  configuration that does not add Login Items, register as a default handler,
  or act on the user's real data.
- **Stop the display with `stop`,** never `kill -9`. A force-killed display
  cannot quit its apps, and macOS moves their windows onto the user's screen.

## Limits

- `CGVirtualDisplay` is private API. It is verified on macOS 27.2, and an update
  can change it. If `display` fails, report it and fall
  back to a proof without screenshots. Do not take over the real screen.
- The app is never the key window. Controls and shortcuts that act on the
  focused view (formatting buttons, Edit menu commands, `cmd+a`) can do
  nothing; buttons, text values, menus, sheets, typing and return work. Test
  through the app's own buttons and fields, or report that path as unverified.
- A window the app opens after `launch` shows on the user's screen until the
  next `park`, usually for under a second. Run `park` right after any action
  that opens one.
- Focus is handed back by a poll during `launch` (about 0.5 s), so the frontmost
  app can flip briefly. Actions that open a window can do the same; check
  `status` afterwards.
- The display, its pidfile and the launched-apps list are shared by every
  session on the machine. Run `status` first, reuse a display that is up, and
  `stop` only one you started.
- The display is 1x, so screenshots do not show Retina (@2x) asset problems.
- A control without a title, description or identifier cannot be matched.
  Give it an `accessibilityIdentifier` in the app; that also helps VoiceOver.
- The user can still move the cursor onto the virtual display by dragging it
  past the bottom-left corner of the main display. Nothing the agent does
  moves it there.
