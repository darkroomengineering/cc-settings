import { describe, expect, test } from "bun:test";
import { gitTransportLines, type TransportProbe } from "../src/lib/git-transport.ts";

const base: TransportProbe = {
  origin: "ssh",
  sshKeys: "none",
  onePassword: false,
  onePasswordUnlocked: false,
  ghLoggedIn: false,
  signing1P: false,
};
const lines = (over: Partial<TransportProbe>) => gitTransportLines({ ...base, ...over });

describe("gitTransportLines", () => {
  test("prints nothing without a GitHub origin", () => {
    expect(lines({ origin: "none", ghLoggedIn: true, sshKeys: "loaded" })).toEqual([]);
  });

  test("SSH remote with a loaded key uses SSH", () => {
    expect(lines({ sshKeys: "loaded", ghLoggedIn: true })).toEqual([
      "Git push: SSH (an agent has a key loaded).",
    ]);
  });

  test("SSH remote, no agent, gh logged in: gh login over HTTPS, no 1Password mention", () => {
    const [line] = lines({ sshKeys: "no-agent", ghLoggedIn: true });
    expect(line).toContain("never retries SSH");
    expect(line).toContain("every push in this session");
    expect(line).toContain('url."https://github.com/".insteadOf=git@github.com:');
    expect(line).toContain(
      "-c credential.helper= -c credential.helper='!gh auth git-credential' push origin HEAD",
    );
    expect(line).not.toContain("1Password");
  });

  test("ssh:// remotes rewrite the ssh:// prefix", () => {
    const [line] = lines({ origin: "ssh-url", ghLoggedIn: true });
    expect(line).toContain("insteadOf=ssh://git@github.com/");
  });

  test("1Password installed adds the unlock hint", () => {
    const [line] = lines({ ghLoggedIn: true, onePassword: true });
    expect(line).toEndWith("(or ask the user to unlock 1Password to use SSH)");
  });

  test("HTTPS remote with gh logged in uses the gh credential helper", () => {
    expect(lines({ origin: "https", ghLoggedIn: true })).toEqual([
      "Git push: gh login (git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin HEAD).",
    ]);
  });

  test("HTTPS remote ignores a loaded SSH key", () => {
    expect(lines({ origin: "https", sshKeys: "loaded" })[0]).toContain("not logged in");
  });

  test("nothing usable asks the user to log in", () => {
    expect(lines({})[0]).toBe(
      "Git push: not logged in. Do not attempt a push; ask the user to run gh auth login or load an SSH key with ssh-add.",
    );
    expect(lines({ onePassword: true })[0]).toEndWith("gh auth login or unlock 1Password.");
  });

  test("signing through a locked 1Password adds the unlock line", () => {
    expect(lines({ signing1P: true, ghLoggedIn: true })[1]).toBe(
      "Commits are signed through 1Password: ask the user to unlock it before committing.",
    );
    expect(lines({ signing1P: true, onePasswordUnlocked: true, ghLoggedIn: true })).toHaveLength(1);
  });
});
