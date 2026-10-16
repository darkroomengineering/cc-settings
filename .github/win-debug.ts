import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const repo = resolve(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "cc-dbg-"));
mkdirSync(join(root, "src", "scripts"), { recursive: true });
mkdirSync(join(root, "src", "lib"), { recursive: true });
mkdirSync(join(root, "safe"));
copyFileSync(join(repo, "src/scripts/codex-hook.ts"), join(root, "src/scripts/codex-hook.ts"));
copyFileSync(join(repo, "src/lib/merge-keyed.ts"), join(root, "src/lib/merge-keyed.ts"));
writeFileSync(join(root, "safe", "t.ts"), "console.log(import.meta.dir); process.exit(7);\n");
writeFileSync(join(root, "src", "scripts", "dir.ts"), "console.log(import.meta.dir);\n");
console.log({ root, real: realpathSync(root), native: realpathSync.native(root) });
const d = Bun.spawnSync(["bun", join(root, "src/scripts/dir.ts")]);
console.log("import.meta.dir:", d.stdout.toString());
const r = Bun.spawnSync(["bun", join(root, "src/scripts/codex-hook.ts"), "safe/t.ts"], {
  env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: join(root, "d") },
  stdin: new Blob(['{"session_id":"s"}']),
});
console.log("exit", r.exitCode, "stdout", r.stdout.toString(), "stderr", r.stderr.toString());
