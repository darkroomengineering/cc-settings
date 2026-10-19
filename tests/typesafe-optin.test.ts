// The per-project TypeSafe opt-in and the install-time disclosure. A key alone
// must never send: the project sets CC_TYPESAFE_PROJECT=1 first. The senders'
// own end-to-end gate tests live in delegation-detector.test.ts (hook process,
// local Jev server) and drift-fuse.test.ts (fake engine).

import { afterEach, describe, expect, test } from "bun:test";
import { TYPESAFE_DISCLOSURE } from "../src/lib/claude-install-settings.ts";
import { TYPESAFE_OPT_IN_VAR, typesafeKey, typesafeProjectOptedIn } from "../src/lib/jev.ts";

const saved = {
  key: process.env.TYPESAFE_API_KEY,
  optIn: process.env[TYPESAFE_OPT_IN_VAR],
};

afterEach(() => {
  for (const [name, value] of [
    ["TYPESAFE_API_KEY", saved.key],
    [TYPESAFE_OPT_IN_VAR, saved.optIn],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("typesafeKey — project opt-in", () => {
  test("a key in the environment is withheld until the project opts in", async () => {
    process.env.TYPESAFE_API_KEY = "k";
    delete process.env[TYPESAFE_OPT_IN_VAR];
    expect(await typesafeKey()).toBeUndefined();
    process.env[TYPESAFE_OPT_IN_VAR] = "1";
    expect(await typesafeKey()).toBe("k");
  });

  test("only the value 1 opts in", () => {
    expect(typesafeProjectOptedIn({})).toBe(false);
    for (const value of ["", "0", "true", "yes"]) {
      expect(typesafeProjectOptedIn({ [TYPESAFE_OPT_IN_VAR]: value })).toBe(false);
    }
    expect(typesafeProjectOptedIn({ [TYPESAFE_OPT_IN_VAR]: "1" })).toBe(true);
  });
});

describe("TYPESAFE_DISCLOSURE", () => {
  const text = TYPESAFE_DISCLOSURE.join("\n");

  test("names the recipient, every sender and the opt-in", () => {
    expect(text).toContain("api.typesafe.ai");
    expect(text).toContain("delegation-detector");
    expect(text).toContain("drift-fuse");
    expect(text).toContain("fast-jev-compaction");
    expect(text).toContain(TYPESAFE_OPT_IN_VAR);
  });

  test("says fast-jev-compaction is not gated by the opt-in and how to turn it off per project", () => {
    expect(text).toContain("cannot gate");
    expect(text).toContain('"fast-jev-compaction@fast-jev-compaction": false');
  });
});
