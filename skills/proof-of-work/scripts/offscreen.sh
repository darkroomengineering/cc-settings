#!/usr/bin/env bash
# Builds offscreen.m on first use (and after it changes), then runs it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/offscreen.m"
bin="${XDG_CACHE_HOME:-$HOME/.cache}/cc-settings/offscreen"
if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
  mkdir -p "$(dirname "$bin")"
  # Build beside the target and rename, so a second first run never executes a half-written binary.
  tmp="$bin.$$"
  clang -fobjc-arc -O2 -Wall -Werror \
    -framework AppKit -framework ApplicationServices -framework CoreGraphics \
    -o "$tmp" "$src"
  mv -f "$tmp" "$bin"
fi
exec "$bin" "$@"
