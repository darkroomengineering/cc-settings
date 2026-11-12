import { getRequestEvent, serializeCookie } from "@solidjs/web";
import type { RequestEvent, ResponseStub } from "@solidjs/web";

export interface SessionOptions {
  /** Newest first, at least 32 characters each; a string is split on commas. */
  secrets: string | readonly string[] | undefined;
  /** Cookie name. Default `session`. */
  name?: string;
  /** Seconds a session lives, for the cookie's Max-Age and the enforced expiry. Default 7 days. */
  maxAge?: number;
}

export interface Session<Data extends object> {
  /** What this request wrote, else what arrived with it; null when missing, tampered, or expired. */
  get: () => Promise<Data | null>;
  /** Replaces the session on the outgoing response and restarts its lifetime. */
  set: (data: Data) => Promise<void>;
  /** Merges into the current session and writes the result; of two at once, the last wins. */
  update: (patch: Partial<Data>) => Promise<Data>;
  /** Expires the cookie on the outgoing response. */
  clear: () => Promise<void>;
}

const DAY = 60 * 60 * 24;

interface Envelope<Data> {
  data: Data;
  /** Unix seconds. */
  exp: number;
}

/** The first key signs, every key verifies. */
type Keys = [signer: Promise<CryptoKey>, ...verifiers: Promise<CryptoKey>[]];

interface Written<Data> {
  data: Data | null;
  /** The Set-Cookie value, to replace on the next write. */
  cookie: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function secretList(secrets: SessionOptions["secrets"]): string[] {
  const list = isList(secrets) ? secrets : (secrets?.split(",") ?? []);
  const trimmed = list.map((s) => s.trim()).filter(Boolean);

  if (trimmed.some((s) => s.length < 32)) {
    throw new Error(
      "[@visio/session] every secret needs at least 32 characters. Generate one with `openssl rand -base64 32`."
    );
  }

  return trimmed;
}

function isList(
  secrets: SessionOptions["secrets"]
): secrets is readonly string[] {
  return Array.isArray(secrets);
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/v, "");
}

/** Also accepts standard base64 with padding. Throws on any other character. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));

  return Uint8Array.from(binary, byteOf);
}

function byteOf(char: string): number {
  const code = char.codePointAt(0);

  if (code === undefined) {
    throw new Error("[@visio/session] atob gave an empty character");
  }

  return code;
}

/** The first `name` cookie in the header: browsers send the longest Path first. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");

    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }

  return null;
}

function currentEvent(): RequestEvent & { response: ResponseStub } {
  const event = getRequestEvent();

  if (!event) {
    throw new Error(
      "[@visio/session] no request event. Call the session inside a server function, middleware, or the SSR render."
    );
  }

  // SAFETY: Solid's server handler puts the response stub on every request event; the type leaves it to the framework.
  return event as RequestEvent & { response: ResponseStub };
}

export function createSession<Data extends object>(
  options: SessionOptions
): Session<Data> {
  const [first, ...rest] = secretList(options.secrets);
  const maxAge = options.maxAge ?? 7 * DAY;

  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new Error(
      `[@visio/session] maxAge must be a positive whole number of seconds, got ${maxAge}.`
    );
  }

  const name = options.name ?? "session";

  if (!/^[\w.\-]+$/v.test(name)) {
    throw new Error(
      `[@visio/session] name "${name}" may only hold letters, digits, _, . and -.`
    );
  }

  // Browsers treat localhost as secure, so `Secure` does not break dev over http.
  const attributes = {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  } as const;

  // What this request wrote so far: get() reads it, and the next write replaces its cookie.
  const written = Symbol(`@visio/session ${name}`);
  let keys: Keys | undefined;

  function ready(): Keys {
    if (first === undefined) {
      throw new Error(
        `[@visio/session] no secrets for the "${name}" cookie. Set SESSION_SECRET (generate one with \`openssl rand -base64 32\`).`
      );
    }

    keys ??= [importKey(first), ...rest.map(importKey)];

    return keys;
  }

  function write(data: Data | null, value: string, age: number): void {
    const event = currentEvent();
    const { headers } = event.response;
    const previous: Written<Data> | undefined = event.locals[written];

    if (previous) {
      const kept = headers.getSetCookie().filter((c) => c !== previous.cookie);
      headers.delete("set-cookie");

      for (const c of kept) {
        headers.append("set-cookie", c);
      }
    }

    const cookie = serializeCookie(name, value, { ...attributes, maxAge: age });
    headers.append("set-cookie", cookie);
    event.locals[written] = { data, cookie } satisfies Written<Data>;
  }

  async function get(): Promise<Data | null> {
    const list = ready();
    const event = currentEvent();
    const previous: Written<Data> | undefined = event.locals[written];

    if (previous) {
      return previous.data;
    }

    const raw = readCookie(event.request.headers.get("cookie"), name);
    const dot = raw?.lastIndexOf(".") ?? -1;

    if (!raw || dot === -1) {
      return null;
    }

    const payload = raw.slice(0, dot);

    try {
      const signature = decodeBase64(raw.slice(dot + 1));
      const signed = encoder.encode(payload);
      const imported = await Promise.all(list);

      const verified = await Promise.all(
        imported.map((key) =>
          crypto.subtle.verify("HMAC", key, signature, signed)
        )
      );

      if (verified.includes(true)) {
        const { data, exp }: Envelope<Data> = JSON.parse(
          decoder.decode(decodeBase64(payload))
        );

        return Number.isFinite(exp) && Date.now() < exp * 1000 ? data : null;
      }
    } catch {
      // A value that is not base64 or not JSON reads as no session.
    }

    return null;
  }

  async function set(data: Data): Promise<void> {
    const [signer] = ready();

    const envelope: Envelope<Data> = {
      data,
      exp: Math.floor(Date.now() / 1000) + maxAge,
    };

    const payload = encodeBase64url(encoder.encode(JSON.stringify(envelope)));

    const signature = await crypto.subtle.sign(
      "HMAC",
      await signer,
      encoder.encode(payload)
    );

    write(
      data,
      `${payload}.${encodeBase64url(new Uint8Array(signature))}`,
      maxAge
    );
  }

  return {
    get,
    set,
    async update(patch) {
      const current = await get();
      // SAFETY: not checked at runtime. On a missing session the patch is all there is, so it must hold every field.
      const next = { ...current, ...patch } as Data;
      await set(next);

      return next;
    },
    clear() {
      try {
        ready();
        write(null, "", 0);
      } catch (error) {
        return Promise.reject(error);
      }

      return Promise.resolve();
    },
  };
}
