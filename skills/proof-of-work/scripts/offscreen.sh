#!/usr/bin/env bash
# Builds offscreen.m on first use (and after it changes), then runs it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/offscreen.m"
bin="${XDG_CACHE_HOME:-$HOME/.cache}/cc-settings/offscreen"
if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
  mkdir -p "$(dirname "$bin")"
  clang -fobjc-arc -O2 -Wall -Werror \
    -framework AppKit -framework ApplicationServices -framework CoreGraphics \
    -o "$bin" "$src"
fi
exec "$bin" "$@"
