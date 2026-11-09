#!/usr/bin/env bash
set -euo pipefail

mkdir -p components lib

cat > package.json <<'JSON'
{ "name": "fixture-shop", "version": "0.0.1", "dependencies": { "react": "19.0.0" } }
JSON

cat > components/newsletter-form.tsx <<'TSX'
"use client";

import { type FormEvent, useState } from "react";

export function NewsletterForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const response = await fetch("/api/subscribe", { method: "POST", body: new FormData(event.currentTarget) });
    if (!response.ok) {
      setIsError(true);
      return;
    }
    setIsSubmitting(false);
    setIsSuccess(true);
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" aria-label="Email" />
      <button type="submit" disabled={isSubmitting}>Subscribe</button>
      {isError && <p role="alert">Something went wrong.</p>}
      {isSuccess && <p>Thanks for subscribing.</p>}
    </form>
  );
}
TSX

cat > lib/order.ts <<'TS'
export interface Order {
  id: string;
  status: "pending" | "paid" | "shipped" | "cancelled";
  paidAt?: Date;
  trackingNumber?: string;
  cancelReason?: string;
}

export function ship(order: Order, trackingNumber: string): Order {
  return { ...order, status: "shipped", trackingNumber };
}

export function cancel(order: Order, reason: string): Order {
  return { ...order, status: "cancelled", cancelReason: reason };
}
TS

cat > components/cart-drawer.tsx <<'TSX'
"use client";

import { useReducer } from "react";

type Drawer = { state: "closed" } | { state: "open" };
type Action = { type: "open" } | { type: "close" };

function reduce(_drawer: Drawer, action: Action): Drawer {
  return action.type === "open" ? { state: "open" } : { state: "closed" };
}

export function CartDrawer({ itemCount }: { itemCount: number }) {
  const [drawer, dispatch] = useReducer(reduce, { state: "closed" });
  return drawer.state === "open" ? (
    <aside>
      {itemCount} items
      <button type="button" onClick={() => dispatch({ type: "close" })}>Close</button>
    </aside>
  ) : (
    <button type="button" onClick={() => dispatch({ type: "open" })}>Cart</button>
  );
}
TSX
