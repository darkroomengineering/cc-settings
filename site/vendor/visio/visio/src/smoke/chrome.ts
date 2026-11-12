import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

export interface Message {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
}

/** The parameters of a protocol call, sent as JSON. */
export type Params = Record<string, string | number | boolean>;

export interface Chrome {
  /** One protocol call, to the browser or, with `sessionId`, to a page. */
  send: <T = unknown>(
    method: string,
    params?: Params,
    sessionId?: string
  ) => Promise<T>;
  /** The next event named `method` on the page, or a rejection after `timeout` ms. */
  once: (
    method: string,
    sessionId: string,
    timeout?: number
  ) => Promise<Message>;
  /** Every event, for a caller that collects them; add and delete its own. */
  listeners: Set<(m: Message) => void>;
  /** A blank tab with a session attached to it. */
  open: () => Promise<{ targetId: string; sessionId: string }>;
  /** Closes the socket, stops Chrome and removes its profile once Chrome has exited. */
  close: () => Promise<void>;
}

function startError(): Error {
  return new Error(
    `Chrome did not start. Is it at ${CHROME}? Set CHROME_PATH.`
  );
}

export async function launchChrome(): Promise<Chrome> {
  const profileDir = mkdtempSync(path.join(tmpdir(), "visio-chrome-"));

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      // Headless has no GPU. WebGL then falls back to SwiftShader, which
      // Chrome warns about on every page unless it is asked for by name.
      // Only the dev server's own pages load here.
      "--enable-unsafe-swiftshader",
      ...(process.env.CHROME_FLAGS?.split(" ").filter(Boolean) ?? []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  // `error` alone when it never started: then `exit` never comes.
  const exit = Promise.withResolvers<number | null>();
  chrome.once("exit", (code) => exit.resolve(code));
  chrome.once("error", () => exit.resolve(null));

  /** Chrome writes to its profile until it exits, so the profile goes after it. */
  async function stop() {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
    }

    await exit.promise;
    rmSync(profileDir, { recursive: true, force: true });
  }

  let wsUrl: string;

  try {
    wsUrl = await listening(chrome.stderr, chrome);
  } catch (error) {
    await stop();
    throw error;
  }

  const socket = new WebSocket(wsUrl);
  const opened = Promise.withResolvers<Event>();
  socket.addEventListener("open", opened.resolve, { once: true });
  await opened.promise;
  let nextId = 0;
  const pending = new Map<number, PromiseWithResolvers<unknown>>();
  const listeners = new Set<(m: Message) => void>();
  socket.addEventListener("message", (event) => {
    // SAFETY: Chrome sends one protocol message per frame, in this shape.
    const msg = JSON.parse(String(event.data)) as Message;

    if (msg.id === undefined) {
      for (const l of listeners) {
        l(msg);
      }
    } else {
      const p = pending.get(msg.id);
      pending.delete(msg.id);

      if (msg.error) {
        p?.reject(new Error(`${msg.error.message}`));
      } else {
        p?.resolve(msg.result);
      }
    }
  });

  async function send<T = unknown>(
    method: string,
    params: Params = {},
    sessionId?: string
  ): Promise<T> {
    nextId += 1;
    const id = nextId;
    const call = Promise.withResolvers<unknown>();
    pending.set(id, call);
    socket.send(JSON.stringify({ id, method, params, sessionId }));

    // SAFETY: the caller names the result type of `method` from the protocol.
    return (await call.promise) as T;
  }

  function once(
    method: string,
    sessionId: string,
    timeout = 60_000
  ): Promise<Message> {
    const event = Promise.withResolvers<Message>();

    const timer = setTimeout(() => {
      listeners.delete(on);
      event.reject(new Error(`timed out waiting for ${method}`));
    }, timeout);

    function on(m: Message) {
      if (m.method === method && m.sessionId === sessionId) {
        clearTimeout(timer);
        listeners.delete(on);
        event.resolve(m);
      }
    }

    listeners.add(on);

    return event.promise;
  }

  async function open() {
    const { targetId } = await send<{ targetId: string }>(
      "Target.createTarget",
      {
        url: "about:blank",
      }
    );

    const { sessionId } = await send<{ sessionId: string }>(
      "Target.attachToTarget",
      {
        targetId,
        flatten: true,
      }
    );

    return { targetId, sessionId };
  }

  return {
    send,
    once,
    listeners,
    open,
    close() {
      socket.close();

      return stop();
    },
  };
}

/** The DevTools WebSocket URL Chrome prints on stderr once it listens. */
function listening(
  stderr: NodeJS.ReadableStream | null,
  chrome: ReturnType<typeof spawn>
): Promise<string> {
  const url = Promise.withResolvers<string>();
  let err = "";
  stderr?.on("data", (chunk: Buffer) => {
    err += chunk.toString();

    const found = /DevTools listening on (?<url>ws:\/\/\S+)/u.exec(err)?.groups
      ?.url;

    if (found) {
      url.resolve(found);
    }
  });
  chrome.on("error", () => url.reject(startError()));
  chrome.on("exit", (code) => {
    const hint = /No usable sandbox/u.test(err)
      ? "\nSet CHROME_FLAGS=--no-sandbox."
      : "";

    url.reject(
      new Error(`Chrome exited (${code}) before it listened:\n${err}${hint}`)
    );
  });
  setTimeout(() => url.reject(startError()), 15_000);

  return url.promise;
}
