// Copied into Vercel's edge middleware with types stripped, so it imports nothing. See DESIGN.md.

export const COOKIE = "__visio_gate";
export const FIELD = "__visio_password";
export const MAX_AGE = 60 * 60 * 24 * 7;
export const PASSWORD_VAR = "SITE_PASSWORD";

export interface GateOptions {
  password: string;
  /** Paths that check their own secret, like a webhook. */
  open?: readonly string[];
}

const encoder = new TextEncoder();

function key(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";

  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/v, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));

    return Uint8Array.from(binary, byteOf);
  } catch {
    return undefined;
  }
}

function byteOf(char: string): number {
  const code = char.codePointAt(0);

  if (code === undefined) {
    throw new Error("[@visio/gate] atob gave an empty character");
  }

  return code;
}

/** Keyed by the password itself: no second secret, and a new password voids every cookie. */
async function issue(password: string, expires: number): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(password),
    encoder.encode(`${expires}`)
  );

  return `${expires}.${toBase64Url(signature)}`;
}

async function valid(password: string, value: string): Promise<boolean> {
  const dot = value.indexOf(".");

  if (dot === -1) {
    return false;
  }

  const expires = Number(value.slice(0, dot));

  if (!Number.isSafeInteger(expires) || expires * 1000 <= Date.now()) {
    return false;
  }

  const signature = fromBase64Url(value.slice(dot + 1));

  if (!signature) {
    return false;
  }

  return crypto.subtle.verify(
    "HMAC",
    await key(password),
    signature,
    encoder.encode(`${expires}`)
  );
}

/** HMAC of both sides, so the comparison is constant-time. */
async function matches(password: string, tried: string): Promise<boolean> {
  // importKey rejects an empty key.
  if (!tried) {
    return false;
  }

  const message = encoder.encode("visio-gate");
  const signature = await crypto.subtle.sign("HMAC", await key(tried), message);

  return crypto.subtle.verify("HMAC", await key(password), signature, message);
}

function cookieValue(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");

    if (eq !== -1 && part.slice(0, eq).trim() === COOKIE) {
      return part.slice(eq + 1).trim();
    }
  }

  return undefined;
}

async function triedPassword(request: Request): Promise<string | undefined> {
  if (request.method !== "POST") {
    return undefined;
  }

  const type = request.headers.get("content-type") ?? "";

  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return undefined;
  }

  const tried = new URLSearchParams(await request.text()).get(FIELD);

  return tried ?? undefined;
}

/** `undefined` lets the request through. */
export async function gate(
  request: Request,
  options: GateOptions
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (options.open?.includes(url.pathname)) {
    return undefined;
  }

  const cookie = cookieValue(request);

  if (cookie && (await valid(options.password, cookie))) {
    return undefined;
  }

  const tried = await triedPassword(request);

  if (tried !== undefined && (await matches(options.password, tried))) {
    const expires = Math.floor(Date.now() / 1000) + MAX_AGE;

    const attributes = [
      "Path=/",
      `Max-Age=${MAX_AGE}`,
      "HttpOnly",
      "SameSite=Lax",
    ];

    if (url.protocol === "https:") {
      attributes.push("Secure");
    }

    return new Response(null, {
      status: 303,
      headers: {
        // `//evil.com` as a path would send the visitor to another site.
        location: url.pathname.replace(/^\/+/u, "/") + url.search,
        "set-cookie": [
          `${COOKIE}=${await issue(options.password, expires)}`,
          ...attributes,
        ].join("; "),
        "cache-control": "private, no-store",
      },
    });
  }

  return form(request, tried !== undefined);
}

function form(request: Request, wrong: boolean): Response {
  return new Response(request.method === "HEAD" ? null : page(wrong), {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex",
    },
  });
}

/** Only built when the password is set, so a missing one is a misconfigured deploy: stay closed. */
export function gateMiddleware(options: Omit<GateOptions, "password"> = {}) {
  return async (request: Request): Promise<Response> => {
    const password = process.env[PASSWORD_VAR];

    if (!password) {
      return new Response(`${PASSWORD_VAR} is not set for this deployment.`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return (
      (await gate(request, { ...options, password })) ??
      // Vercel's pass-through signal.
      new Response(null, { headers: { "x-middleware-next": "1" } })
    );
  };
}

function page(wrong: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Password required</title>
<style>
:root { color-scheme: light dark; }
* { margin: 0; box-sizing: border-box; }
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace;
  background: light-dark(#fff, #000);
  color: light-dark(#000, #fff);
}
form { position: relative; display: flex; gap: 1rem; }
input {
  height: 50px;
  padding: 0 1rem;
  font: inherit;
  font-size: 1rem;
  background: transparent;
  border: 1px solid ${wrong ? "#ff4444" : "light-dark(#000, #fff)"};
  color: inherit;
  outline: none;
}
input:focus-visible { outline: 2px solid light-dark(#000, #fff); outline-offset: 2px; }
button {
  flex-shrink: 0;
  height: 50px;
  width: 95px;
  font: inherit;
  background: light-dark(#000, #fff);
  color: light-dark(#fff, #000);
  border: none;
  cursor: pointer;
}
button:hover { opacity: 0.9; }
.error { position: absolute; top: 56px; left: 111px; font-size: 0.875rem; color: #ff4444; }
.mark { position: relative; flex-shrink: 0; height: 50px; width: 95px; background: light-dark(#000, #fff); }
.mark::after { content: ''; position: absolute; top: 24px; height: 3px; width: 70px; background: light-dark(#fff, #000); }
</style>
</head>
<body>
<form method="post">
<div class="mark" aria-hidden="true"></div>
<input type="password" name="${FIELD}" aria-label="Password" placeholder="Password" required autofocus autocomplete="current-password">
${wrong ? '<p class="error" role="alert">Wrong password</p>' : ""}
<button type="submit">Enter</button>
</form>
</body>
</html>
`;
}
