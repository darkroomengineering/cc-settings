#!/usr/bin/env bash
set -euo pipefail

mkdir -p utils

cat > package.json <<'EOF'
{
  "name": "fixture-app",
  "version": "0.0.1"
}
EOF

cat > utils/formatCurrency.ts <<'EOF'
export function formatCurrency(amount: number, currency = 'USD'): string {
  const rounded = Math.round(amount * 100) / 100
  return `${currency} ${rounded.toFixed(2)}`
}
EOF

cat > utils/formatMoney.ts <<'EOF'
export function formatMoney(amount: number, currency = 'USD'): string {
  const rounded = Math.round(amount * 100) / 100
  return `${currency} ${rounded.toFixed(2)}`
}
EOF

cat > utils/parsePrice.ts <<'EOF'
export function parsePrice(input: string): number {
  return parseInt(input)
}
EOF
