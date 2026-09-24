#!/usr/bin/env bash
set -euo pipefail
mkdir -p fixtures
cat > fixtures/widget.ts <<'EOF'
interface WidgetProps {
  size: "sm" | "md" | "lg";
  /** @deprecated no longer used by any caller */
  legacyCompactMode?: boolean;
}

export function Widget({ size, legacyCompactMode }: WidgetProps) {
  if (legacyCompactMode) {
    return renderCompact(size);
  }
  return renderNormal(size);
}

function renderCompact(size: string) {
  return `compact-${size}`;
}

function renderNormal(size: string) {
  return `normal-${size}`;
}
EOF
cat > fixtures/app.ts <<'EOF'
import { Widget } from "./widget";

export function render() {
  return Widget({ size: "md" });
}
EOF
