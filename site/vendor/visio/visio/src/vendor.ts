import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue } from "./json.ts";

export const REPO = "darkroomengineering/visio";
export const VENDOR_DIR = "vendor/visio";
export const ASSET = "visio.tar.gz";
export const TAG = /^v\d{4}\.\d{2}\.\d{2}-\d{4}$/u;

export interface Manifest {
  tag: string;
  commit: string;
  /** The visio catalog: the versions the packages are tested with. */
  catalog: Record<string, string>;
  /** The exact Solid versions from bun.lock, for the project's `overrides`. */
  pins: Record<string, string>;
  /** sha256 of each file, by its path in `vendor/visio/`. */
  files: Record<string, string>;
}

function sorted(entries: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(entries).toSorted(([a], [b]) => (a < b ? -1 : 1))
  );
}

function run(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0) {
    throw new Error(
      `[visio] ${cmd.join(" ")} failed:\n${result.stderr.toString().trim()}`
    );
  }

  return result.stdout.toString();
}

/** Every file under `dir` but `manifest.json` and `node_modules`, which `bun install` may add. */
export function hashTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};

  function walk(rel: string) {
    for (const entry of readdirSync(path.join(dir, rel), {
      withFileTypes: true,
    })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.name === "node_modules" || name === "manifest.json") {
        continue;
      }

      if (entry.isDirectory()) {
        walk(name);
      } else {
        files[name] = createHash("sha256")
          .update(readFileSync(path.join(dir, name)))
          .digest("hex");
      }
    }
  }

  walk("");

  return sorted(files);
}

interface TreeDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

function diffTree(
  want: Record<string, string>,
  found: Record<string, string>
): TreeDiff {
  return {
    changed: Object.keys(want).filter(
      (f) => f in found && found[f] !== want[f]
    ),
    added: Object.keys(found).filter((f) => !(f in want)),
    removed: Object.keys(want).filter((f) => !(f in found)),
  };
}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, "manifest.json");

  if (!existsSync(file)) {
    throw new Error(
      `[visio] ${file} is missing. Install the packages with \`bun run visio:update\` (visio/DESIGN.md, Releases).`
    );
  }

  // SAFETY: pack() writes the manifest, and an edit to it fails `visio:check`.
  return JSON.parse(readFileSync(file, "utf-8")) as Manifest;
}

const PINNED = /^(?:solid-js|@solidjs\/[\w-]+|seroval[\w-]*)$/u;

/** The versions bun.lock resolves for the Solid packages. */
export function lockedPins(lockfile: string): Record<string, string> {
  const pins: Record<string, string> = {};

  for (const { groups } of lockfile.matchAll(
    /^ {4}"(?<name>[^"]+)": \["(?:[^"@]|@[^"@]+\/)[^"@]*@(?<version>[^"]+)"/gmu
  )) {
    const { name, version } = groups ?? {};

    if (name === undefined || version === undefined) {
      throw new Error(
        "[visio] The bun.lock pattern lost its name or version group."
      );
    }

    if (PINNED.test(name)) {
      pins[name] = version;
    }
  }

  return sorted(pins);
}

/** The edits in `vendor/visio/`, as one message, or undefined when it is the release. */
export function vendorEdits(root: string): string | undefined {
  const dir = path.join(root, VENDOR_DIR);
  const manifest = readManifest(dir);
  const diff = diffTree(manifest.files, hashTree(dir));

  const lines = [
    ...diff.changed.map((f) => `  changed  ${f}`),
    ...diff.added.map((f) => `  added    ${f}`),
    ...diff.removed.map((f) => `  removed  ${f}`),
  ];

  if (!lines.length) {
    return undefined;
  }

  return (
    `[visio] [VENDOR_EDITED] ${VENDOR_DIR} differs from release ${manifest.tag}:\n${lines.join("\n")}\n` +
    `Do not edit ${VENDOR_DIR}: the next update replaces it. Make the change in github.com/${REPO}, ` +
    "release it, and run `bun run visio:update`. To drop the edits, run `git checkout -- vendor/visio`."
  );
}

interface RootPackage {
  workspaces?:
    | string[]
    | { packages?: string[]; catalog?: Record<string, string> };
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
  [key: string]: JsonValue | undefined;
}

const SCRIPTS = {
  "visio:update": `bun ${VENDOR_DIR}/visio/bin/visio-vendor.ts update`,
  "visio:check": `bun ${VENDOR_DIR}/visio/bin/visio-vendor.ts check`,
};

/** Named as in the skills, so a project's own script of that name wins. */
const SKILL_SCRIPTS = {
  smoke: `bun ${VENDOR_DIR}/visio/bin/visio-smoke.ts`,
};

/** The project's scripts, minus a skill script an earlier release wrote, so a moved bin follows. */
function ownScripts(scripts: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(scripts).filter(
      ([name, command]) =>
        !(name in SKILL_SCRIPTS && command.startsWith(`bun ${VENDOR_DIR}/`))
    )
  );
}

/** Writes `from` into `into`, and returns a line for each version that changed. */
function merge(
  kind: string,
  into: Record<string, string>,
  from: Record<string, string>
) {
  return Object.entries(from)
    .filter(([name, version]) => into[name] !== version)
    .map(([name, version]) => {
      const before = into[name];
      into[name] = version;

      return `${kind}: ${name} ${before ? `${before} -> ` : ""}${version}`;
    });
}

export function syncProject(root: string, manifest: Manifest): string[] {
  const file = path.join(root, "package.json");
  // SAFETY: the project's package.json, which bun reads with these field types.
  const pkg = JSON.parse(readFileSync(file, "utf-8")) as RootPackage;

  const ws = Array.isArray(pkg.workspaces)
    ? { packages: pkg.workspaces }
    : (pkg.workspaces ?? {});

  const packages = ws.packages ?? [];

  if (!packages.includes(`${VENDOR_DIR}/*`)) {
    packages.push(`${VENDOR_DIR}/*`);
  }

  const catalog = { ...ws.catalog };
  const overrides = { ...pkg.overrides };

  const changed = [
    ...merge("catalog", catalog, manifest.catalog),
    ...merge("overrides", overrides, manifest.pins),
  ];

  let next = place(pkg, "workspaces", { ...ws, packages, catalog });
  next = place(next, "scripts", {
    ...SKILL_SCRIPTS,
    ...ownScripts(pkg.scripts),
    ...SCRIPTS,
  });
  next = place(next, "overrides", sorted(overrides));
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);

  return changed;
}

const LOCK_BIN = /\n {6}"bin": (?:"[^"\n]*"|\{(?:\n {8}[^\n]*)*\n {6}\}),/u;

/** Writes each vendored package's `bin` into its workspace entry in `bun.lock` (DESIGN.md, Releases). */
export function syncLockBins(root: string): string[] {
  const file = path.join(root, "bun.lock");

  if (!existsSync(file)) {
    return [];
  }

  let lock = readFileSync(file, "utf-8");
  const changed: string[] = [];
  const vendor = path.join(root, VENDOR_DIR);

  for (const dir of readdirSync(vendor, { withFileTypes: true })) {
    const json = path.join(vendor, dir.name, "package.json");

    if (!dir.isDirectory() || !existsSync(json)) {
      continue;
    }

    // SAFETY: a vendored package's package.json, packed by `bun pm pack`.
    const { name, bin } = JSON.parse(readFileSync(json, "utf-8")) as {
      name?: string;
      bin?: string | Record<string, string>;
    };

    const start = lock.indexOf(`\n    "${VENDOR_DIR}/${dir.name}": {\n`);

    if (start === -1) {
      continue;
    }

    const end = lock.indexOf("\n    },", start + 1);
    const entry = lock.slice(start, end);
    let next = entry.replace(LOCK_BIN, "");

    if (bin !== undefined) {
      const value =
        typeof bin === "string"
          ? JSON.stringify(bin)
          : `{\n${Object.entries(bin)
              .map(
                ([k, v]) =>
                  `        ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`
              )
              .join("")}      }`;

      const after =
        /\n {6}"version": [^\n]*/u.exec(next) ??
        /\n {6}"name": [^\n]*/u.exec(next);

      if (!after) {
        continue;
      }

      const at = after.index + after[0].length;
      next = `${next.slice(0, at)}\n      "bin": ${value},${next.slice(at)}`;
    }

    if (next === entry) {
      continue;
    }

    lock = lock.slice(0, start) + next + lock.slice(end);
    changed.push(`bun.lock: the bin of ${name ?? dir.name}`);
  }

  if (changed.length) {
    writeFileSync(file, lock);
  }

  return changed;
}

const SKILLS_DIR = ".claude/skills";

/** Links the release's skills into .claude/skills, and returns a line for each change. */
export function linkSkills(root: string): string[] {
  const vendor = path.join(root, VENDOR_DIR);
  const skills = path.join(root, SKILLS_DIR);
  const want = releaseSkills(vendor, skills);
  mkdirSync(skills, { recursive: true });
  const removed = removeStaleLinks(vendor, skills, want);
  const added: string[] = [];
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const [name, target] of [...want].toSorted(([a], [b]) =>
    a < b ? -1 : 1
  )) {
    const link = path.join(skills, name);
    const stat = lstatSync(link, { throwIfNoEntry: false });

    if (stat && !(stat.isSymbolicLink() && intoVendor(vendor, skills, link))) {
      const own = stat.isSymbolicLink()
        ? `a link to ${readlinkSync(link)}`
        : "not a link";

      skipped.push(
        `skills: skipped ${SKILLS_DIR}/${name}: it is the project's own skill (${own}). Remove it to get the ${name} skill of the release.`
      );
      continue;
    }

    if (stat && readlinkSync(link) === target) {
      continue;
    }

    if (stat) {
      rmSync(link);
    }

    symlinkSync(target, link);
    (stat ? changed : added).push(name);
  }

  const changes = [
    added.length ? `added ${added.join(", ")}` : "",
    changed.length ? `changed ${changed.join(", ")}` : "",
    removed.length ? `removed ${removed.toSorted().join(", ")}` : "",
  ].filter(Boolean);

  const count = `skills: ${want.size - skipped.length} linked`;

  return [
    changes.length ? `${count}; ${changes.join("; ")}` : `${count}, no change`,
    ...skipped,
  ];
}

/** Each skill of the release, by name, with its link target from `skills`. */
function releaseSkills(vendor: string, skills: string): Map<string, string> {
  const want = new Map<string, string>();

  for (const dir of readdirSync(vendor, { withFileTypes: true })) {
    const from = path.join(vendor, dir.name, "skills");

    if (!dir.isDirectory() || !existsSync(from)) {
      continue;
    }

    for (const skill of readdirSync(from, { withFileTypes: true })) {
      if (!skill.isDirectory()) {
        continue;
      }

      const target = path.relative(skills, path.join(from, skill.name));
      const other = want.get(skill.name);

      if (other) {
        throw new Error(
          `[visio] Two packages have a skill named ${skill.name}: ${other} and ${target}. Rename one in the visio repo.`
        );
      }

      want.set(skill.name, target);
    }
  }

  return want;
}

function intoVendor(vendor: string, skills: string, link: string): boolean {
  return !path
    .relative(vendor, path.resolve(skills, readlinkSync(link)))
    .startsWith("..");
}

/** Deletes the broken links into the release of skills it no longer has, and returns their names. */
function removeStaleLinks(
  vendor: string,
  skills: string,
  want: Map<string, string>
): string[] {
  const removed: string[] = [];

  for (const entry of readdirSync(skills, { withFileTypes: true })) {
    const link = path.join(skills, entry.name);

    // A link to a skill the release still has is the project's own name for it.
    if (
      !entry.isSymbolicLink() ||
      want.has(entry.name) ||
      !intoVendor(vendor, skills, link) ||
      existsSync(link)
    ) {
      continue;
    }

    rmSync(link);
    removed.push(entry.name);
  }

  return removed;
}

/** The order oxfmt keeps for these fields, so a project's format check passes after an update. */
const KEY_ORDER = [
  "name",
  "version",
  "private",
  "description",
  "bin",
  "workspaces",
  "files",
  "type",
  "exports",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "resolutions",
  "overrides",
  "engines",
  "packageManager",
];

/** `pkg` with `key` after the last field that comes before it in `KEY_ORDER`. */
function place<K extends string>(
  pkg: RootPackage,
  key: K,
  value: RootPackage[K]
): RootPackage {
  const keys = Object.keys(pkg).filter((k) => k !== key);
  const before = new Set(KEY_ORDER.slice(0, KEY_ORDER.indexOf(key)));
  keys.splice(keys.findLastIndex((k) => before.has(k)) + 1, 0, key);

  // SAFETY: every field keeps the value of pkg, and `key` gets a value of its own field's type.
  return Object.fromEntries(
    keys.map((k) => [k, k === key ? value : pkg[k]])
  ) as RootPackage;
}

/** Replaces `vendor/visio/` with release `tag`, or the latest release. */
export function update(root: string, tag?: string): void {
  if (tag !== undefined && !TAG.test(tag)) {
    throw new Error(`[visio] ${tag} is not a release tag (v2026.10.08-1432).`);
  }

  const dir = path.join(root, VENDOR_DIR);

  if (existsSync(path.join(dir, "manifest.json"))) {
    const edits = vendorEdits(root);

    if (edits) {
      throw new Error(
        `${edits}\nThe update stopped, so the edits are not lost.`
      );
    }
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "visio-"));

  try {
    run(
      [
        "gh",
        "release",
        "download",
        ...(tag ? [tag] : []),
        "-R",
        REPO,
        "-p",
        ASSET,
        "-D",
        tmp,
      ],
      root
    );
    run(["tar", "-xzf", ASSET], tmp);
    // Fails on a release without a manifest, before the old one is removed.
    readManifest(path.join(tmp, VENDOR_DIR));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    cpSync(path.join(tmp, VENDOR_DIR), dir, { recursive: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Packs every package of the visio repo at `repo` into `out`/visio.tar.gz. */
export function pack(repo: string, out: string, tag: string): Manifest {
  if (!TAG.test(tag)) {
    throw new Error(`[visio] ${tag} is not a release tag (v2026.10.08-1432).`);
  }

  rmSync(out, { recursive: true, force: true });
  const stage = path.join(out, "stage");
  const dir = path.join(stage, VENDOR_DIR);
  mkdirSync(dir, { recursive: true });
  const tarballs = path.join(out, "tarballs");
  mkdirSync(tarballs);
  const packages = path.join(repo, "packages");

  for (const name of readdirSync(packages)) {
    if (!existsSync(path.join(packages, name, "package.json"))) {
      continue;
    }

    const before = new Set(readdirSync(tarballs));
    run(
      ["bun", "pm", "pack", "--destination", tarballs, "--quiet"],
      path.join(packages, name)
    );
    const tgz = readdirSync(tarballs).find((f) => !before.has(f));

    if (!tgz) {
      throw new Error(
        `[visio] bun pm pack wrote no tarball for packages/${name}.`
      );
    }

    mkdirSync(path.join(dir, name));
    run(
      [
        "tar",
        "-xzf",
        path.join(tarballs, tgz),
        "-C",
        path.join(dir, name),
        "--strip-components=1",
      ],
      out
    );
    const json = readFileSync(path.join(dir, name, "package.json"), "utf-8");

    if (/"(?:workspace|catalog):/u.test(json)) {
      throw new Error(
        `[visio] packages/${name}: pack left a workspace: or catalog: range.`
      );
    }
  }

  // SAFETY: the visio repo's package.json, which bun reads with these field types.
  const root = JSON.parse(
    readFileSync(path.join(repo, "package.json"), "utf-8")
  ) as RootPackage;

  const manifest: Manifest = {
    tag,
    commit: run(["git", "rev-parse", "HEAD"], repo).trim(),
    catalog:
      (Array.isArray(root.workspaces) ? undefined : root.workspaces?.catalog) ??
      {},
    pins: lockedPins(readFileSync(path.join(repo, "bun.lock"), "utf-8")),
    files: hashTree(dir),
  };

  writeFileSync(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  run(["tar", "-czf", path.join(out, ASSET), "-C", stage, "vendor"], out);

  return manifest;
}

function list(items: string[]) {
  return items.map((s) => `- ${s}`).join("\n");
}

export function releaseNotes(subjects: string[]): string {
  const breaking = subjects.filter((s) => /^\w+(?:\([^)]*\))?!:/u.test(s));
  const rest = subjects.filter((s) => !breaking.includes(s));

  return [
    breaking.length ? `## Breaking\n\n${list(breaking)}\n` : "",
    rest.length ? `## Changes\n\n${list(rest)}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The headings of the notes, in the order a reader needs them (DESIGN.md, Releases). */
const HEADINGS = ["Breaking", "Features", "Fixes", "Optional"];

export interface ReleaseBody {
  tag: string;
  body: string;
}

/** The notes of several releases as one, by heading and then by release, so the breaking changes come first. */
export function mergeNotes(releases: ReleaseBody[]): string {
  const sections = new Map<string, string[]>();

  for (const { tag, body } of releases) {
    for (const part of `\n${body}`.split(/\n## /u)) {
      const heading = part.startsWith("\n")
        ? "Notes"
        : part.slice(0, part.indexOf("\n")).trim();

      const text = (
        part.startsWith("\n") ? part : part.slice(part.indexOf("\n"))
      ).trim();

      if (text) {
        sections.set(heading, [
          ...(sections.get(heading) ?? []),
          `### ${tag}\n\n${text}`,
        ]);
      }
    }
  }

  return [...sections]
    .toSorted(([a], [b]) => headingRank(a) - headingRank(b))
    .map(([h, texts]) => `## ${h}\n\n${texts.join("\n\n")}`)
    .join("\n\n");
}

/** The place of a heading in `HEADINGS`; any other heading comes after them, in the order it came. */
function headingRank(heading: string): number {
  const at = HEADINGS.indexOf(heading);

  return at === -1 ? HEADINGS.length : at;
}

/** The published releases after `from` up to `to`, oldest first, or only `to` when `from` is undefined. */
export function releasesBetween(
  root: string,
  from: string | undefined,
  to: string
): ReleaseBody[] {
  return run(
    [
      "gh",
      "release",
      "list",
      "-R",
      REPO,
      "--exclude-drafts",
      "--limit",
      "200",
      "--json",
      "tagName",
      "-q",
      ".[].tagName",
    ],
    root
  )
    .split("\n")
    .filter(
      (t) =>
        TAG.test(t) && (from === undefined ? t === to : t > from && t <= to)
    )
    .toSorted()
    .map((tag) => ({
      tag,
      body: run(
        [
          "gh",
          "release",
          "view",
          tag,
          "-R",
          REPO,
          "--json",
          "body",
          "-q",
          ".body",
        ],
        root
      ),
    }));
}
