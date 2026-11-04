#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "test@example.com"
git config user.name "Test"
mkdir -p app
cat > app/page.tsx <<'EOT'
export default function Page() {
  return <main className="p-8">Tally</main>;
}
EOT
git add app/page.tsx
git commit -q -m "chore: placeholder page"
cat > app/page.tsx <<'EOT'
import Shield from "lucide-react/dist/esm/icons/shield";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Zap from "lucide-react/dist/esm/icons/zap";

const features = [
  { icon: Zap, title: "Blazing fast", body: "Supercharge your invoicing workflow." },
  { icon: Shield, title: "Secure", body: "Enterprise-grade security, seamlessly built in." },
  { icon: Sparkles, title: "AI-powered", body: "Unlock smarter billing with AI." },
];

export default function Page() {
  return (
    <main className="min-h-svh bg-zinc-950 text-zinc-100">
      <section className="relative flex flex-col items-center px-6 py-32 text-center">
        <div className="absolute -top-20 size-96 rounded-full bg-purple-600/40 blur-3xl" aria-hidden />
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs uppercase tracking-widest">
          ✨ New: Tally 2.0 →
        </span>
        <h1 className="mt-6 bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-6xl font-bold text-transparent">
          Invoice faster. Get paid smarter.
        </h1>
        <p className="mt-4 max-w-xl text-zinc-400">
          It's not just invoicing. It's a whole new way to run your business.
        </p>
        <div className="mt-8 flex gap-4">
          <a href="/signup" className="rounded-full bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 shadow-lg shadow-purple-500/50">
            Get started →
          </a>
          <a href="/demo" className="rounded-full border border-zinc-800 px-6 py-3">
            Watch demo →
          </a>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl grid-cols-3 gap-6 px-6 pb-32">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-zinc-800 p-6">
            <Icon className="size-6 text-purple-400" aria-hidden />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
EOT
