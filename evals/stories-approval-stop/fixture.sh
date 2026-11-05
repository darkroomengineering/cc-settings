#!/usr/bin/env bash
set -euo pipefail

mkdir -p .context/stories/acme
cat > scope.md <<'MD'
# Acme Coffee: pre-launch site, signed scope

1. Waitlist sign-up on the homepage: name and email. The client wants it on the product page too.
2. Countdown to the launch date on the homepage hero. Client (Dana, 2 Oct): "When it hits zero it should just say we're open."
3. The store owner edits the launch date and the hero headline without a developer.
4. A press strip with five logos under the hero. No carousel.
MD
