// Exemption logic for the pre-PR proof gate. This decides whether `gh pr
// create/ready` gets the full test+lint gate — a bug here means the gate
// silently exempts a real "ready" PR (no protection) or gates a draft (false
// block), so lock every branch.

import { describe, expect, test } from "bun:test";
import { shouldGate } from "../src/hooks/pre-pr-proof.ts";

describe("pre-pr-proof — shouldGate exemption logic", () => {
  test("gates a plain PR create/ready", () => {
    expect(shouldGate("gh pr create --title x --body y")).toBe(true);
    expect(shouldGate("gh pr ready 123")).toBe(true);
  });

  test("gates create/ready even with gh global options before `pr`", () => {
    expect(shouldGate("gh -R owner/repo pr create --title x")).toBe(true);
    expect(shouldGate("gh --repo owner/repo pr ready")).toBe(true);
  });

  test("allows non-readiness commands", () => {
    expect(shouldGate("git push origin feature")).toBe(false);
    expect(shouldGate("gh pr view --json headRefOid")).toBe(false);
    expect(shouldGate("gh pr checks")).toBe(false);
    expect(shouldGate("echo hello")).toBe(false);
  });

  test("exempts an enabled --draft / -d (explicitly not-ready)", () => {
    expect(shouldGate("gh pr create --draft --title x")).toBe(false);
    expect(shouldGate("gh pr create --title x --draft")).toBe(false);
    expect(shouldGate("gh pr create -d --title x")).toBe(false);
  });

  test("still gates an explicitly-disabled --draft (a real PR)", () => {
    expect(shouldGate("gh pr create --draft=false --title x")).toBe(true);
    expect(shouldGate("gh pr create --draft false --title x")).toBe(true);
  });

  test("exempts `gh pr ready --undo` (reverts to draft)", () => {
    expect(shouldGate("gh pr ready --undo")).toBe(false);
  });

  test("per-segment: an exempt segment cannot shadow a gated one", () => {
    // A draft create followed by a real ready — the ready must still gate.
    expect(shouldGate("gh pr create --draft && gh pr ready")).toBe(true);
    // An unrelated earlier `--draft` must not exempt the real create.
    expect(shouldGate("echo --draft && gh pr create --title x")).toBe(true);
  });
});
