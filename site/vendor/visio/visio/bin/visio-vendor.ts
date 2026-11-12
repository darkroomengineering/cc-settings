#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";

import {
  linkSkills,
  mergeNotes,
  readManifest,
  releasesBetween,
  syncLockBins,
  syncProject,
  TAG,
  update,
  VENDOR_DIR,
  vendorEdits,
} from "../src/vendor.ts";

const [command, tag] = process.argv.slice(2);
const root = process.cwd();

try {
  if (command === "update") {
    const dir = path.join(root, VENDOR_DIR);

    const from = existsSync(path.join(dir, "manifest.json"))
      ? readManifest(dir).tag
      : undefined;

    update(root, tag);

    // This process runs the release it replaced, so the steps after the download run in the new one.
    const sync = Bun.spawnSync(
      [
        "bun",
        path.join(dir, "visio", "bin", "visio-vendor.ts"),
        "sync",
        ...(from ? [from] : []),
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" }
    );

    // A child stopped by a signal has no exit code.
    process.exit(sync.exitCode ?? 1);
  } else if (command === "sync") {
    const from = tag;

    if (from !== undefined && !TAG.test(from)) {
      throw new Error(
        `[visio] ${from} is not a release tag (v2026.10.08-1432).`
      );
    }

    const manifest = readManifest(path.join(root, VENDOR_DIR));

    for (const line of [
      ...syncProject(root, manifest),
      ...syncLockBins(root),
      ...linkSkills(root),
    ]) {
      console.log(`[visio] ${line}`);
    }

    const releases = releasesBetween(root, from, manifest.tag);

    // Before the install, which a removed package makes fail (DESIGN.md, Releases).
    if (releases.length) {
      console.log(
        `\n[visio] The notes of ${releases.map((r) => r.tag).join(", ")}. Act on Breaking, then read the rest:\n\n${mergeNotes(releases)}\n`
      );
    }

    const install = Bun.spawnSync(["bun", "install"], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });

    if (install.exitCode !== 0) {
      console.error(
        "[visio] bun install failed. If a Breaking entry above names the cause, do its steps, then run `bun install` again."
      );
      process.exit(install.exitCode);
    }

    console.log(
      `[visio] ${VENDOR_DIR} is release ${manifest.tag} (${manifest.commit.slice(0, 7)})${from && from !== manifest.tag ? `, was ${from}` : ""}.`
    );
  } else if (command === "check") {
    const edits = vendorEdits(root);

    if (edits) {
      console.error(edits);
      process.exit(1);
    }

    console.log(
      `[visio] ${VENDOR_DIR} is release ${readManifest(path.join(root, VENDOR_DIR)).tag}.`
    );
  } else {
    console.error(
      "[visio] Usage: visio-vendor update [tag] | visio-vendor check"
    );
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
