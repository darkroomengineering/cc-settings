#!/usr/bin/env bash
set -euo pipefail

mkdir -p app public/fonts

cat > package.json <<'JSON'
{
  "name": "client-site",
  "version": "0.0.1",
  "scripts": { "build": "next build", "start": "next start" },
  "dependencies": { "next": "16.0.0", "react": "19.2.0", "react-dom": "19.2.0" }
}
JSON

# A placeholder file stands in for the shipped variable font.
printf 'wOF2placeholder' > public/fonts/Display-Variable.woff2

cat > app/layout.tsx <<'TSX'
import localFont from 'next/font/local'
import './globals.css'

const display = localFont({
  src: '../public/fonts/Display-Variable.woff2',
  weight: '100 900',
  preload: true,
  variable: '--font-display',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  )
}
TSX

cat > app/page.tsx <<'TSX'
export default function Home() {
  return (
    <main>
      <h1 style={{ fontWeight: 650 }}>Café opening hours</h1>
      <p>We're open every day — except Mondays…</p>
    </main>
  )
}
TSX

cat > app/globals.css <<'CSS'
body { font-family: var(--font-display), system-ui; font-weight: 400; }
h1 { font-feature-settings: "ss01"; }
p { hyphens: auto; }
CSS
