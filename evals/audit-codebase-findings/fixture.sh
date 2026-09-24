#!/usr/bin/env bash
set -euo pipefail

mkdir -p utils legacy

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

cat > legacy/oldReportGenerator.ts <<'EOF'
// Generates legacy quarterly reports. Not imported anywhere in the app.
export function generateLegacyReport(data: unknown[]): string {
  let out = ''
  for (const row of data) {
    out += JSON.stringify(row) + '\n'
  }
  return out
}

export function generateLegacyReportV2(data: unknown[]): string {
  let out = ''
  for (const row of data) {
    out += JSON.stringify(row) + '\n'
  }
  return out
}
EOF
