import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Canonical list of cc-settings-managed skill directories.
//
// "Managed" means: the installer is allowed to wipe and re-write these on every
// install. Hand-authored skills outside this list are preserved.
//
// The list is split into two sections:
//   1. Currently shipped skills — present in skills/<name>/SKILL.md, installed
//      to ~/.claude/skills/<name>/
//   2. Upgrade-cleanup tombstones — names of skills that were removed in prior
//      releases. Kept here so re-install on an older user prunes the obsolete
//      directories from ~/.claude/skills/. Do not remove tombstones; they are
//      load-bearing for upgrades. When promoting a tombstone (renaming back
//      into active use is rare), move it to the active section.
//
// Imported by:
//   - src/setup.ts            — to know what to wipe + reinstall
//   - src/lib/status.ts       — to compute present/missing for `cc status`
//   - src/lib/lint-skills.ts  — to assert ACTIVE_SKILLS matches skills/ on disk
//
// Previously duplicated across both files; the duplication caused real drift
// risk (every new skill required edits in two places).
//
// INVARIANT: ACTIVE_SKILLS must list exactly the directories under skills/.
// lint-skills enforces this — a skill added to skills/ without an ACTIVE_SKILLS
// entry fails `bun run lint:skills`. (This replaces the old installer-side prune
// loop that re-read skills/ directly to cover the gap; the gap is now a lint
// error instead of silent install drift.)

/** Currently shipped skills — present in skills/<name>/SKILL.md, installed to
 *  ~/.claude/skills/<name>/. Keep in sync with the skills/ directory. */
export const ACTIVE_SKILLS = [
  "audit",
  "autoresearch",
  "build",
  "cc",
  "checkpoint",
  "codex",
  "component",
  "context-doc",
  "dr-init",
  "explore",
  "fix",
  "freeze",
  "handoff",
  "harvest",
  "hook",
  "orchestrate",
  "poke-holes",
  "proof-of-work",
  "refactor",
  "retro",
  "review",
  "review-batch",
  "share-learning",
  "ship",
  "triage",
  "zero-tech-debt",
];

/** Upgrade-cleanup tombstones — skills removed in prior releases. Kept so a
 *  re-install on an older user prunes the obsolete directories. Do not remove;
 *  they are load-bearing for upgrades. When reviving one, move it to
 *  ACTIVE_SKILLS and recreate its skills/<name>/ directory. */
export const TOMBSTONE_SKILLS = [
  "adhd",
  "adversarial-audit",
  "ask",
  "cc-sync",
  "cc-update",
  "compare-approaches",
  "consolidate",
  "context",
  "create-handoff",
  "darkroom-init",
  "debug",
  "design-tokens",
  "discovery",
  "docs",
  "effort",
  "f-thread",
  "figma",
  "init",
  "l-thread",
  "learn",
  "lenis",
  "lighthouse",
  "long-task",
  "nuclear-review",
  "oracle",
  "pinchtab",
  "plan-ceo-review",
  "plan-feature",
  "prd",
  "premortem",
  "project",
  "qa",
  "resume-handoff",
  "strategist",
  "tdd",
  "teams",
  "test",
  "tldr",
  "verify",
  "versions",
  "write-a-skill",
  "zoom-out",
];

/** Everything the installer may wipe + reinstall: active skills plus tombstones
 *  to prune. Consumers that only care about the wipe set use this. */
export const MANAGED_SKILLS = [...ACTIVE_SKILLS, ...TOMBSTONE_SKILLS];

export interface LegacyCodexSkillScan {
  root: string;
  overlapNames: string[];
  movableNames: string[];
  blockedNames: string[];
}

export interface LegacyCodexSkillMigration {
  scan: LegacyCodexSkillScan;
  backupDir: string | null;
  movedNames: string[];
  applied: boolean;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Find user-scope skills created by an older Codex /import that duplicate
 * the skills supplied by darkroom@cc-settings. Never follows symlinks. */
export async function scanLegacyCodexSkills(home = homedir()): Promise<LegacyCodexSkillScan> {
  const agentsRoot = join(resolve(home), ".agents");
  const root = join(agentsRoot, "skills");
  const agentsMetadata = await lstat(agentsRoot).catch((error: unknown) => {
    if (missing(error)) return null;
    throw error;
  });
  if (!agentsMetadata) return { root, overlapNames: [], movableNames: [], blockedNames: [] };
  if (!agentsMetadata.isDirectory() || agentsMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills parent: ${agentsRoot}`);
  }
  const rootMetadata = await lstat(root).catch((error: unknown) => {
    if (missing(error)) return null;
    throw error;
  });
  if (!rootMetadata) return { root, overlapNames: [], movableNames: [], blockedNames: [] };
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills root: ${root}`);
  }

  const active = new Set(ACTIVE_SKILLS);
  const overlapNames: string[] = [];
  const movableNames: string[] = [];
  const blockedNames: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!active.has(entry.name)) continue;
    overlapNames.push(entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) movableNames.push(entry.name);
    else blockedNames.push(entry.name);
  }
  return {
    root,
    overlapNames: overlapNames.sort(),
    movableNames: movableNames.sort(),
    blockedNames: blockedNames.sort(),
  };
}

function migrationTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(".", "-");
}

export function formatLegacyCodexSkillOverlap(scan: LegacyCodexSkillScan): string | null {
  if (scan.overlapNames.length === 0) return null;
  const names = scan.overlapNames.slice(0, 8).join(", ");
  const rest = scan.overlapNames.length > 8 ? `, +${scan.overlapNames.length - 8} more` : "";
  return (
    `WARNING: ${scan.overlapNames.length} legacy ${scan.root} entries duplicate ` +
    `darkroom@cc-settings (${names}${rest}). Codex may shorten skill descriptions. ` +
    "Preview the safe move with `bun run migrate:codex-skills`; apply it with " +
    "`bun run migrate:codex-skills --apply`."
  );
}

/** Move only overlapping real directories to a timestamped sibling backup.
 * Dry-run is the default. A failed move rolls earlier moves back. */
export async function migrateLegacyCodexSkills(
  options: { home?: string; apply?: boolean; now?: Date } = {},
): Promise<LegacyCodexSkillMigration> {
  const scan = await scanLegacyCodexSkills(options.home);
  if (scan.overlapNames.length === 0) {
    return { scan, backupDir: null, movedNames: [], applied: false };
  }
  const backupDir = join(
    resolve(options.home ?? homedir()),
    ".agents",
    `skills-backup-cc-settings-${migrationTimestamp(options.now ?? new Date())}`,
  );
  if (!options.apply) {
    return { scan, backupDir, movedNames: [], applied: false };
  }
  if (scan.blockedNames.length > 0) {
    throw new Error(
      `Refusing to move non-directory or symlinked legacy skill entries: ${scan.blockedNames.join(", ")}`,
    );
  }
  if (existsSync(backupDir)) throw new Error(`Backup destination already exists: ${backupDir}`);

  // Revalidate every boundary immediately before the first rename. Detection
  // may have raced another process, and a replaced path must fail closed.
  const rootMetadata = await lstat(scan.root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe legacy skills root: ${scan.root}`);
  }
  for (const name of scan.movableNames) {
    const metadata = await lstat(join(scan.root, name));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Legacy skill changed during migration: ${name}`);
    }
  }

  await mkdir(backupDir);
  const movedNames: string[] = [];
  try {
    for (const name of scan.movableNames) {
      await rename(join(scan.root, name), join(backupDir, name));
      movedNames.push(name);
    }
  } catch (error) {
    const restoreErrors: Array<{ name: string; error: unknown }> = [];
    for (const name of movedNames.reverse()) {
      try {
        await rename(join(backupDir, name), join(scan.root, name));
      } catch (restoreError) {
        restoreErrors.push({ name, error: restoreError });
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors.map(({ error: restoreError }) => restoreError)],
        `Legacy skill migration failed and rollback was incomplete for ${restoreErrors
          .map(({ name }) => name)
          .join(", ")}; preserve and inspect ${backupDir}`,
      );
    }
    await rmdir(backupDir).catch(() => {});
    throw error;
  }
  return { scan, backupDir, movedNames, applied: true };
}

// Git blob ids of every skills/<name>/SKILL.md cc-settings ever shipped under a
// tombstoned name. A leftover retired skill is offered for removal only when
// its SKILL.md matches one of these byte for byte, so a user's own skill that
// happens to reuse a name (docs, context, init) is never touched. Regenerate
// for a newly tombstoned name with:
//   git log --all --format=%H -- skills/<name>/SKILL.md |
//     while read c; do git rev-parse -q --verify "$c:skills/<name>/SKILL.md"; done | sort -u
const RETIRED_SKILL_BLOBS: Readonly<Record<string, readonly string[]>> = {
  adhd: [
    "86ded1c818a6f1a38a2d4629d3f4b89abfa98ebe",
    "8c839b4876ed2acdffe4a072d70d3952ce11f7bb",
    "992904b47e2f41793e1fd669d099932e6b7d8f84",
    "9cda437060a426e4e051914d9eef15aec8f82d4d",
    "c8be7eca48fe46c6b0682538501e4642c077169f",
    "c8fef5348670bf62d64b3b701840e4963a0cdfd0",
  ],
  "adversarial-audit": [
    "07a7c62095b12bc91b624cfc00704c22a9a962c4",
    "36ba4e35900a1991db425e0bcf3cc6b46acd1aab",
    "81098ce116dafa1daabdba42c7478505f0c3932d",
    "eaa96292649eb1ef9b5b55d5f0359c1a3cb17b91",
  ],
  ask: [
    "085f1e892e5039b27d1f5e479dcdcfd02db2ca5d",
    "08d6df6214994929e758c3d3f372b6c95b39d674",
    "7451fb398cdd0410268582dc4ae7fa0556be1da7",
    "837e573bbb60a369c015c7e1a9c5071f5fe1848a",
  ],
  "cc-sync": [
    "4c4762d6e3eec64a6438ebde9c835d83fba9f73f",
    "98d6972d9ef95822461c729d3feafc3e5e664298",
    "e6cdda493039c15e411f70adaf5008ca2894db9e",
  ],
  "cc-update": [
    "03f6678ba7ad0cbd704e75aab5d5e9d03711b280",
    "57677eedb23780a237899a29533570de19a5f344",
    "da4f4e552b71cdf82c60b8bf378961805f754140",
  ],
  "compare-approaches": [
    "3b9e7e5662135b5ade07dc8baf5ad8ef3882b17d",
    "54fa533f252faea67e967d4d5e2ef179d4e3e841",
  ],
  consolidate: [
    "00cb69ce49dae78626eec350d29bb777090f0c19",
    "011be0ec751f2fc317cdd73d95b7e1b354de0aab",
    "355871d841c9825ce7670f0ab4aa5f7bcf8b12b2",
    "7f06347d25118a7a34207fc2926e134632c5c81c",
    "8c8597941eea0dd9698c87b91a090f16a9eb279b",
    "a10bb6e719592582f339691748011c230eea0dca",
    "a8b63b1eae6ffd833b44189cde4890e8ea105f87",
    "b7b86d2b0cc718d317423a01ae49410dde963994",
    "c2b22cb7c2e5eeac132c0f123b25cc4d5a672b68",
    "cb99761438e2d9437ac3ec587723ad9f170cb200",
  ],
  context: [
    "304081626abdbf08475dccbef7831d945d6c5a0c",
    "31ec72555e76047b140f62a5e5a4ed5f3e1512f7",
    "333328782b250acf22818d0915f1a077f5bc8088",
    "38cc57fd3204d068c3a9f8cd805dfd682d67743c",
    "5861625c1d943a03323e3cb2d3567bdd6af2e4e5",
    "96d9e2694c3fc10cbec1cd3c849d3c520c1bddbd",
    "c7981d6370bdf4dbca5336685427defb3d889ef0",
    "ddb91af1f3169721ea7060a25bf07e16b62ae914",
    "f1667304421f859f2c2edd0337e5b5e55a55d3fd",
  ],
  "create-handoff": [
    "1e0a443fdb99c0d11dd344cac5bab09a8da6da1b",
    "214accfbac2cc6d4ef400ebeb8395025af587c86",
    "67068d7d6f96d7f2526d4b5eacac8bb83d7d0d56",
    "7f3c481c12fad960df43345fbbf5e08beeef8326",
    "b34d0ddf089f807bfdc4978a5aa0b254fa5b0226",
    "b415a736a6580ec013495f763afd47510df4c4e7",
    "e9e270ccd673aebab1dbe503104d7dc6f1bb7579",
    "f78d22892ca96b45883def164d5aeeb33204a384",
    "f7b64ede0e0b2a764a301c8dc78a11410baa7b21",
    "fed4daa95b4ff35992c279efebd44beeb897478f",
  ],
  debug: [
    "435c7f4281e4d2c147cf4a4df16ed3a45e8e4115",
    "4fcf591f9ead77b994024be513afad93790578c0",
    "81deb02dc668d33bebf787a912a18b2677100c06",
    "8a775f97b25558942477d01330e70c1ef08c4a99",
    "a96b5f51cd4768b1492c9f9ad5d2f96206037d5a",
    "c1ee0979c3c8fd8537a0141986bf2deef04932e4",
    "d5fdb62e25d8e9d32ba9d9124ddf5fcab6ca7e63",
  ],
  "design-tokens": [
    "051395d59def4dd66f181be76eebcf2f443e74e4",
    "3408495fc4580e5b2e869dcf25c655d6ac2e3e3e",
    "46bf76dc6bde81718614a26fec7b64e393f96e76",
    "7c4a317f6dc4e5541d3aef56095a57b2c89d6279",
    "934c43e7eef2c82e9c0972061aff279ea3b6cd98",
    "95397099843fde04574f961f9d92308d9f11243f",
    "b79bee63490ac2afb51aaf39908517bd5a41ba76",
    "d4e1db50e3fcfc54f2657b1b35ba7123bb5e4843",
    "dda46dcd4dc209974ef405c97ffb266a19645060",
    "dea36faa9253eec65c6ca41cc41882952fb980c0",
    "ef4b990ab94d632e19ec8c8e32c8d314e0dfa73e",
  ],
  discovery: [
    "60cc23be932016997671bb9e075a79b81d2e0282",
    "610d341765e84d016ed1f0c3f33258d943bf3df7",
    "8a9af8df71ed76067095306868556acde4d47098",
    "aba0c25e86f1a151c6da282c9f677364b609cef4",
  ],
  docs: [
    "33985410bfc11d60a12d65249442e18be533a4a5",
    "3c916b8109ea27ccee7641c53f795ed1f2935f19",
    "709f563e20adfe4e1418b65a90e89420ac1f4ada",
    "8f669dde628f9ee6c12ea2c825ecf2a0d7dbc106",
    "dbeebd530a695606d82c183d22273fd0f34cff26",
  ],
  effort: [
    "0a7a5a10e1814f6085538bc6caa9281c5e60dedf",
    "34d7c38b93293262f27fd0996fd458ccfef6382d",
    "4e3618e1caf18f7826cfcf4096b09ae698663c31",
  ],
  "f-thread": [
    "038cbcb1d2207e7766a00ce4ab60c138cf621280",
    "9a1cc982c6391e84be73354b5d6760b601595a6c",
    "c3a05e870c01526db7034162794fb00f6bbd520e",
    "ee5e183b210c40da1fd2129a913845b5677dfd19",
  ],
  figma: [
    "41fa3f20bced4985771381a85ce86820a3f95d41",
    "4ccefda883cf9d24a42a59b009f0cc48e9ccc69a",
    "67d2303e2c51566f5abc41048eb865ee115b98be",
    "a3e65f3a06e00a0dcf383e4aeb06176f2e673863",
    "ce649a1b3ff33adf40ac2d43f0d2ca7a6cef1747",
    "ded873819587452af75d75946214a5f3db14fe72",
  ],
  init: [
    "0d5b4e34859c50d127e46cc4a69de2d7fd35dc8d",
    "530509950bfcfa24926d28a5aba1182841655e11",
    "5945482313416b4ab3bede52e0fbf8420255f089",
    "5cea9588af5df93dd43b6964fda8d9570a679b80",
  ],
  "l-thread": [
    "5190ee0d9927f399babcd23171658941a941b8fc",
    "58ec1e0a7a5614261670994297e7e324bee41109",
    "5c6b3e279ba825cbff780c58f88576883abdda59",
    "5c6ef474ffbdc601f5744c1bc9c1deea5a97ec9e",
    "90aec139f2db7ac80edcd3931ad4cf83155321e1",
    "dd6f56f2fd456ea469c7e7187ea2da38ee1e98af",
    "e5311a25718ef4498518ce2992a02ba2b7b82262",
  ],
  learn: [
    "19e1045ab1a262dcb0bc6f5b05e5f2358df00a21",
    "3cd74f5c9cbe1c185a99dc3cd262b92ef573d7db",
    "43370e5da810ad0b4249dfe2de994668e11c7f6f",
    "4fdcea3c847235f3b17c55d2a1bbd49deef24163",
    "8c65a96e51fcd8c66d35959c344869f8ca5f4163",
    "ec444e871ea37a8ab75b7501770d72bf76264c7d",
    "fcd0dbe15a7e9181557cda82e7078e8ed933df9e",
  ],
  lenis: [
    "539078849f066c496b8cf31ee1ec2a598f7dfb89",
    "58d1cc02e0381c7b7c7f7d6bb2341f1cff67f783",
    "5bdc2f1019d61f0518d37bac839e8cd3c4a05e15",
    "6e7577d0c63ea36f1b58431fc33614923c93c844",
  ],
  lighthouse: [
    "011939e050f717cf7489b7c61941233453046472",
    "069faacd7b4c4a6962710bdb8faf6d40f47888e1",
    "1499565af6183adae458d7e1c22439630fc8ee48",
    "256b23e8dc3f1245c14a10566f30732f063dfc0b",
    "3782dcdcb0c677a27540e20eec487abf8de0e847",
    "3b88a6f51c998e61a388dd00a4b9ffde061daa31",
    "3e3723e4c19d1171c92b2e747d5e451ce4ee7e16",
    "43ed718e52e700df0c7e8e5a2bae21857a5c4142",
    "5b8f2a90fa957d7c5051ecd06d40bb575cb39829",
    "5cc9c6cd37d91102d487267ffa54f833d22570ca",
    "712ca71c833b041ca5b7c2e2c826d4d8b5339e21",
    "87eaf03a29a15a9d1a356ce0ae13110ab22596f5",
    "9c9b51708f504ea8dbcc58bbe4aa404180ae551a",
    "c2868ccebedcfddbe892ecebead30b2767e5cb37",
    "c520d8b74cc7835d29ed0ad163427b2efa2ba268",
    "ce0ab970ea3f6cc088149f23371a02c5dc045ab4",
    "d84a0b01157ffa525a12cf8382d056a0b62e4476",
  ],
  "long-task": [
    "87e94275f6d74ac2d5fd9568105b18b76e8a888b",
    "a3f07931737557c0307a2635317401d681bb1b34",
    "d027c6369e3cd01ff31971a81fa55d1675cd1eff",
  ],
  "nuclear-review": [
    "0155d0644f5be8aa17ae7ef5841df877bae60f49",
    "0b27e473d7cb15d61a9ebaf1c69fba3b171f9eb2",
    "2a56f05ca4ffa76543c99c446eb9ad3e6160319e",
    "324edf5db7b2202f3ce095bc13a8c95ca3a5ce91",
    "4a99d576b1a4d5aa7233bac88f1c83184f32b3ff",
    "6d0a2b473cf411dd897f211224277da8fe4481f5",
    "724053a27c8257aacce6ef8f6fc5cd85bcf8853b",
    "9a6e99681375724cc6ed4e8b790056519aa765b3",
    "cacb0456d232934e8c9edd6c5785472e96ceed97",
    "d4b3ac7b11fd7d83f7f9fb43fa7ece2a34eb3790",
    "da8a86fda9c9e2d4bdc551287290e96718331141",
    "dadefe4b7710da94ed09eb24c5f85e119ed595ea",
    "e2e8ddfad56f9cf4f7d2ebc23754043321fce874",
    "fd77993433c9fed3fc7620738acedc8e766637a2",
  ],
  oracle: [
    "1761ece3e94b4c7a21578c7b80ed11258cec7606",
    "1796893d937c3f040613a8acda4fcc23360475b0",
    "199d91621254ea5b580452be92c12dee702481e5",
    "40698cd4277039274eda92ee11215b968be1fcae",
    "524f20e6b65bef9f85c00383bf3697e89969810c",
    "8b491969fc2dbb7045aec75d304e775d7a17ec69",
    "b6644be5c6d5b14a7a57c2263f32d27e19ed7153",
    "b9aeb6f369f36b94ad0a9d8aae0e215cdb3efca8",
    "e8904724c169c47b40cb3994577f8c3f90fdb0c9",
  ],
  pinchtab: ["09aa1f85646047be65e6faf1b3ee98acceb114b8"],
  "plan-ceo-review": [
    "1f5cc53eae449f75c68eabb726acbe638270b1fe",
    "207a48f2117facc131706ca227a73e51ed94c43f",
    "3eb205dc90f903cbaf92d1a428814046a96cd792",
    "4ae20e8bf4973d00025594c56bb77d20abf4fa82",
    "4e6665c5e132778dc4568ebc4321b86cb199c5f1",
    "721e3e80bf3c0a2a7d00484b46a09b72633ed6ee",
    "72eb62df07da5a7d3d90db0e7557b183470c9bc6",
    "73b335af70330cba24c59e8a216acc6be609f377",
    "7f25ec06833ce3a41a8d9af43df6270866b6c0ea",
    "8769a557678c3be5f4ab98d6d593c22dd0b50dc2",
  ],
  "plan-feature": [
    "068f346d3db11669ea077802f17179db4def33a4",
    "3f711bd243bd34812446f8c03b79c2d800eff7e1",
    "6998c3393828f2f0c8aa7a5accfcf4359ec8b602",
    "987bfb0519290897f2bf7e82ea08453e6e67c0ee",
    "bffa3557e941b7bee078d8274a6c5a6d99b1ed37",
    "c9b17f23c0b7f803e5e125bbfcea20ee53b9b71d",
    "d0bec2046702bbb0905e09fc8906af2ca5d9cfd4",
    "d77bd9033b2bd8ab83ea7add003b64f107522c90",
  ],
  prd: [
    "6fe79d6973d94dccb9d03695195d307338f5bc63",
    "cb764b0755527cd11971570465dee0a31ac38db3",
    "dc874285ed4ad1e91dd861b08155ddd0d024ae5a",
    "f55e13efea415959a90aa3fcd0d475cd5d037201",
  ],
  premortem: [
    "4c19a08c7ac279ec0625239195b8724660c5b1ae",
    "7954f503bb17689b0f5fcb0144c0199a61be16b1",
    "a3b5dd05f2d95b23bd3b33cb76b5547c84da7620",
  ],
  project: [
    "0400cf33eb3f0a2fe280430a9f8e2dddbb2a6988",
    "10b413591303f9c082d155b70e6e873ec0ce6529",
    "2532125723f9967dca3bd8321f4840f90eabb7ac",
    "3439d6924b20f58627c7e2368926120b71f2eb8f",
    "516cace58b82bcb571416d1c998ceb999a4ce345",
    "5b5fb20058c06ef1ff0b3a44a2f4d496d06aaa60",
    "d1947a83794c91929762d9920edf947fa3e63b14",
  ],
  qa: [
    "08ec5b85ac9f150f7f5596771ed9c94ffa6ff0fe",
    "0c3598c3a30ed3443f29a48cd1b56fb7ee60ffd5",
    "0dfd77a5efa96509933ff39d780629430815d694",
    "1594f95f96612ceb60fd6da383b9961d327224ff",
    "1b089ce9f9eb88853896f91b69733a5e334994d6",
    "28c59ffc76cb1fb709cba6e46d1c12071146e3ef",
    "30c2cad576706f8dc9daf6406496b141d0c4f645",
    "48ed791ca51d39d8041c236afe0bb9fea789db33",
    "8a93b8c86d9e794bb328912343ba88adfa78f5b2",
    "90c8ca0bb2f7f298736b60af42b92ecebfc8844f",
    "96bd960908b30e5d02027e27c73b0b57935d39d8",
    "9739d8c34f6d356e4943cfa306b16bdd326e1f9e",
    "ac0ae5855312509337e7d96af7a423bf98cf01b2",
    "b31939cb352dece83a66ec2adb9beba3e04fb68d",
    "c361d6583c86ce5934d783830d7ce1dc35298655",
    "c55ed2a6bd5306a75abc2820b5fed5016ac97552",
    "cc0a416654633fdab0cc88328a019ea5d1e80bf8",
    "d497172af3feaf97c6447050a25b561f2eb1b28e",
    "dcc69528f0a2ecf25bbef058f13496c4cc2b8b55",
    "eb933d87e56a411b906cd8202277995ec410658e",
    "f5efeb98448b00b38ecbe1ed518b38acbc24d971",
    "fd3fd63bd4a043889b8de1ecc8b83c1f5d58b352",
    "fdf5f22a87f4c1421eeba64167175326a4ac9d99",
  ],
  "resume-handoff": [
    "00a2cd5ad123d425ea4fafa4482e43b715858e62",
    "246fe99edd69011273695a40784f5e36a27e5911",
    "9e97eb2617a609c368789fa394a68940cd295c47",
    "ad81b8192ff02e0128e1ccb73eb796e469a46731",
    "b7f534d9f0b4dce0b3d69918aca2d898f2bb6f0a",
    "f2bd11cc73105652d1302b9b98c97ff330596edc",
  ],
  strategist: [
    "014618091fb1dcfaa9699def65b025d74636910b",
    "019c8ed455ca17090423e60e1afe7ce62a199413",
    "38c5ed3f946d2c975584cf5b5b42f61951b8ab6b",
    "7c76c3ce635d911e675600fc66aad8131c3769e6",
    "9b23b7b5ccdf8a5fdd496d52158d654688811b41",
    "9d52568ae7ded196dcf3afb3070f80e21ce0f60b",
    "abf2f679f6f63eb24cab36f23bd3441d6b17eb3a",
    "e928ef6f2b9cc080777ea5cc14d9cd72212b4282",
    "f9aa9ec823c631df21f41e94996488e6e862a1e3",
  ],
  tdd: [
    "0d52e11bcc8a6ba0679a3aec58b3e7af8512cf97",
    "14a4fc0a868df3cd77dcb72a497fc6ed62e4cebd",
    "5c8b41a8ff516d358fbbaec513ca995f341af8f8",
    "9a7953c1c3426981609f2bada37670de79db7ad1",
  ],
  teams: [
    "265784cf7e800c545b120c60201fe4a900e037c7",
    "6f6fb12b73cf7ee6e2448395f835674286e39745",
    "709d29bd0652371b9271fd967042c22be38b7098",
    "96c3270619c48560da8f62b392557bb31d03f88b",
    "f8b99a44ec4531033b6ad4c8bb24bbfe0a3f20fc",
  ],
  test: [
    "1216b802915d95104e2fb19b24777894a22fd46b",
    "396bc7ed1e8dee4b136081bfdf5b532a87e7ce7a",
    "3b878102c7561b06a792ff3de2aa6f4283c384c3",
    "4e544f91fb819548d1a5ffa3564e6378ca2044f6",
    "6543479d9a2d7a0ff8b22c19becabcc1507b5f09",
    "9890784b78fb996f708cacc296311e5f70b36b2a",
    "c79578c2d54651734af1b77cd304f753cedae726",
  ],
  tldr: [
    "001a7ddc8b2f26d899044f573d673d8ef1fa2805",
    "157a35b0ba23a0133422c609f755857ac8af6d18",
    "1af17ac7cf31cf62fd1fc37cfb8789e0d8cdfb8a",
    "2cbf0d9cc5e565d9063abe3853dbb1f874caa10a",
    "398fc137e18094a3a687dd4105f32a318a067a55",
    "556bb996e2039ae35a56a2b2c0a14e017b393004",
    "5e1f92d7828139ea344e4884ac84725d496400fb",
    "61b070a2c3c132251d40cc1c3d51738dd6aaaaad",
    "6d3230ce2acd1d56e4cdf02708953dec89ab8a52",
    "77a079b5ac4be02ba69595d49dcb9aa5425881a7",
    "79d375ad6b9510876c52d46ecca4d1affd7a2412",
    "7a7d9dd150ce052fc6cd4760b2a02a8268dc742b",
    "a9680534f2e114f5391384fd531c5f587a7b6991",
    "b2a2516d29311c2e31ee23a0ef04497435008e57",
    "b54f69d9b3361efb79d8c775fc2954547e6c407e",
    "e1ea2f6cdad271161ddb5567be4532a1bd89539c",
  ],
  verify: [
    "0ddd4b846399f1295b8fb27fd618d9dbe4bd6fe5",
    "19ea6a7ea5b64caa88a912210a956129cfbad16f",
    "1e8d4db23fa4368f2beb57c976d5e52979283d68",
    "37fa18516229d818bfa3c29fd2616f786dc9958a",
    "61832f28acbb4dae80cb834f6c77146c630205e5",
    "63abebd0a933779c40e596a149cc46d92124e9e9",
    "6d911939d5d5860b927fedb9be2891c6d26c2332",
    "7ea3019a706f29bbc95b56ed90f8ccfadc8be021",
    "8812c51241127207f60088bb816fb15b89d546b2",
    "8f908c7d43d020440fcb8da37bdafd5f8618c9a5",
    "a7f9278a80cc5747cc25a5c19d6a27e354bf8de9",
    "f9906f42674a1872bbb0a47e84b973573243220f",
  ],
  versions: [
    "792278a19d368004fede310e8e38f710e59e1c1a",
    "90af55a7bd9d8faec40806274e8f2c00aeddcc03",
    "9747181de654e3fc26bbf56a9f7c87d5c0d000a0",
  ],
  "write-a-skill": [
    "0a1ce9fcf38af6ff4c08ce80e596af327acba950",
    "4ef3e6856e8485c7c7d4a1dbc3c24332cb79f5ef",
    "a203e047b300ffd6e03e6171dc251b02fe770856",
  ],
  "zoom-out": [
    "92b7c714b3bed3dc34b0b1ed48d74925010da840",
    "b683036c37995fe3371e455c7b0f1427125c8124",
  ],
};

function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Tombstoned skill directories still present in `skillsDir` whose SKILL.md is
 *  an unmodified copy of a version cc-settings shipped. Full installs remove
 *  only sentinel-recorded files, so skills installed before the sentinel
 *  existed survive every reinstall unless something removes them. */
export async function scanRetiredSkills(skillsDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of TOMBSTONE_SKILLS) {
    const known = RETIRED_SKILL_BLOBS[name];
    if (!known) continue;
    const dir = join(skillsDir, name);
    const info = await lstat(dir).catch(() => null);
    if (!info?.isDirectory()) continue;
    const bytes = await readFile(join(dir, "SKILL.md")).catch(() => null);
    if (bytes && known.includes(gitBlobId(bytes))) found.push(name);
  }
  return found;
}

/** Move retired skill directories into one backup folder instead of deleting
 *  them, so a wrong call is recoverable. Returns the backup folder. */
export async function retireSkills(
  skillsDir: string,
  names: readonly string[],
  backupRoot: string,
  stamp: string,
): Promise<string> {
  const backupDir = join(backupRoot, `retired-skills-${stamp}`);
  await mkdir(backupDir, { recursive: true });
  for (const name of names) await rename(join(skillsDir, name), join(backupDir, name));
  return backupDir;
}
