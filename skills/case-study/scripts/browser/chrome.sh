#!/bin/bash
# Headless Chrome on the real GPU, 1920x1080, never throttled (a hidden headed window stops rAF and hangs screenshots).
# usage: chrome.sh <profile-dir> [port=9333]   — run in the background; drive it with cdp.js (CDP_URL=http://127.0.0.1:<port> for a non-default port)
PORT=${2:-9333}
# another session's browser may already own the port; Chrome would start without it and your commands would drive their browser
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT is taken (another session's browser?): pass a free port and set CDP_URL=http://127.0.0.1:<port>" >&2; exit 1; fi
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=$PORT \
  --user-data-dir="$1" --window-size=1920,1080 --hide-scrollbars --use-angle=metal --enable-gpu --ignore-gpu-blocklist \
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --autoplay-policy=no-user-gesture-required --no-first-run about:blank 2>/dev/null
