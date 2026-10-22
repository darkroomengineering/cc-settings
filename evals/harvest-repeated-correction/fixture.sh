#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
mkdir -p lib components
cat > lib/api.ts <<'EOF'
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
EOF
cat > biome.json <<'EOF'
{ "linter": { "enabled": true, "rules": { "recommended": true } } }
EOF
cat > components/UserCard.tsx <<'EOF'
export async function UserCard({ id }: { id: string }) {
  const res = await fetch(`/users/${id}`);
  const user = await res.json();
  return <div>{user.name}</div>;
}
EOF
git add -A
git commit -q -m "feat: add api client and UserCard"
cat > components/UserCard.tsx <<'EOF'
import { apiClient } from "../lib/api";

export async function UserCard({ id }: { id: string }) {
  const user = await apiClient<{ name: string }>(`/users/${id}`);
  return <div>{user.name}</div>;
}
EOF
git commit -qam "fix: UserCard uses apiClient instead of raw fetch (review correction)"
cat > components/OrderList.tsx <<'EOF'
import { apiClient } from "../lib/api";

export async function OrderList() {
  const orders = await apiClient<{ id: string }[]>("/orders");
  return <ul>{orders.map((o) => <li key={o.id}>{o.id}</li>)}</ul>;
}
EOF
git add -A
git commit -qm "fix: OrderList goes through apiClient, not fetch (second correction)"
cat > components/Cart.tsx <<'EOF'
export async function Cart() {
  const res = await fetch("/cart");
  const cart = await res.json();
  return <div>{cart.items.length} items</div>;
}
EOF
git add -A
git commit -qm "feat: add Cart"
