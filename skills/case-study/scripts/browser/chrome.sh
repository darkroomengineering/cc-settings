#!/bin/bash
# Headless Chrome on the real GPU, 1920x1080, never throttled (a hidden headed window stops rAF and hangs screenshots).
# usage: chrome.sh <profile-dir> [port=9333]   — run in the background; drive it with cdp.js
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=${2:-9333} \
  --user-data-dir="$1" --window-size=1920,1080 --hide-scrollbars --use-angle=metal --enable-gpu --ignore-gpu-blocklist \
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --autoplay-policy=no-user-gesture-required --no-first-run about:blank 2>/dev/null
