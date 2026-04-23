#!/usr/bin/env bun
// Learning management — port of scripts/learning.sh.
// Per-project knowledge store at ~/.claude/learnings/<project>/learnings.json.
//
// Commands: store | recall | delete | prune | list

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { atomicWriteJson } from "../lib/mcp.ts";

const PROJECT_DIR = process.cwd();
let PROJECT_NAME = basename(PROJECT_DIR);
const LEARNINGS_BASE = join(homedir(), ".claude", "learnings");
let LEARNINGS_DIR = join(LEARNINGS_BASE, PROJECT_NAME);
let LEARNINGS_FILE = join(LEARNINGS_DIR, "learnings.json");

type Learning = {
  id: string;
  timestamp: string;
  category: string;
  learning: string;
  context: string;
  branch: string;
};

type Store = {
  project: string;
  path: string;
  learnings: Learning[];
};

function generateId(): string {
  // 8-hex-char hash of time + random — mirrors the bash `shasum | head -c 8`.
  const seed = `${process.pid}-${Date.now()}-${Math.random()}`;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(seed);
  return hasher.digest("hex").slice(0, 8);
}

async function runGit(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

async function ensureStore(): Promise<Store> {
  await mkdir(LEARNINGS_DIR, { recursive: true });
  if (!existsSync(LEARNINGS_FILE)) {
    const empty: Store = { project: PROJECT_NAME, path: PROJECT_DIR, learnings: [] };
    await atomicWriteJson(LEARNINGS_FILE, empty);
    return empty;
  }
  try {
    return JSON.parse(await readFile(LEARNINGS_FILE, "utf8")) as Store;
  } catch {
    // corrupt file → start fresh but don't silently wipe: throw.
    throw new Error(`Corrupt learnings file: ${LEARNINGS_FILE}`);
  }
}

function formatLearning(l: Learning): string {
  const date = l.timestamp.split("T")[0] ?? "";
  const out = [`  [${date}] [${l.category}] ${l.learning}`];
  if (l.context) out.push(`             └─ Context: ${l.context}`);
  if (l.branch) out.push(`             └─ Branch: ${l.branch} (ID: ${l.id})`);
  else out.push(`             └─ ID: ${l.id}`);
  out.push("");
  return out.join("\n");
}

function printLearnings(learnings: Learning[]): void {
  console.log("");
  console.log(`📚 LEARNINGS: ${PROJECT_NAME}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`Found ${learnings.length} learning(s):`);
  console.log("");
  for (const l of learnings) console.log(formatLearning(l));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function cmdStore(args: string[]): Promise<number> {
  const force = args.includes("--force") || args.includes("-f");
  const rest = args.filter((a) => a !== "--force" && a !== "-f");
  const [category, text, context = ""] = rest;
  if (!category || !text) {
    console.log("");
    console.log("📚 STORE LEARNING");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("Usage: learning.ts store <category> <learning> [context]");
    console.log("");
    console.log("Categories: bug | pattern | gotcha | tool | perf | config | arch | test");
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return 1;
  }

  const store = await ensureStore();
  if (!force && store.learnings.some((l) => l.learning === text)) {
    console.log("");
    console.log("⚠️  DUPLICATE LEARNING");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("An identical learning already exists:");
    console.log(`  ${text}`);
    console.log("");
    console.log("Use --force to store anyway.");
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return 1;
  }

  const branch = await runGit(["rev-parse", "--git-dir"]).then(async (dir) =>
    dir ? runGit(["branch", "--show-current"]) : "",
  );

  const learning: Learning = {
    id: generateId(),
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    category,
    learning: text,
    context,
    branch,
  };
  store.learnings.push(learning);
  await atomicWriteJson(LEARNINGS_FILE, store);

  console.log("");
  console.log("✅ LEARNING STORED");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`📁 ID: ${learning.id}`);
  console.log(`📂 Category: ${category}`);
  console.log(`📝 Learning: ${text}`);
  if (context) console.log(`📍 Context: ${context}`);
  console.log(`🏷️  Project: ${PROJECT_NAME}`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return 0;
}

async function cmdRecall(args: string[]): Promise<number> {
  const [filterType = "", filterValue = "", limitStr = "10"] = args;
  const limit = Number.parseInt(limitStr, 10) || 10;

  if (filterType === "all-projects") {
    console.log("");
    console.log("📚 ALL PROJECT LEARNINGS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    try {
      for (const name of readdirSync(LEARNINGS_BASE)) {
        const pFile = join(LEARNINGS_BASE, name, "learnings.json");
        if (!existsSync(pFile)) continue;
        try {
          const s = JSON.parse(await readFile(pFile, "utf8")) as Store;
          console.log(`  📂 ${name}: ${s.learnings.length} learning(s)`);
        } catch {
          // skip
        }
      }
    } catch {
      // no learnings base
    }
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return 0;
  }

  if (filterType === "project" && filterValue) {
    PROJECT_NAME = filterValue;
    LEARNINGS_DIR = join(LEARNINGS_BASE, PROJECT_NAME);
    LEARNINGS_FILE = join(LEARNINGS_DIR, "learnings.json");
  }

  if (!existsSync(LEARNINGS_FILE)) {
    console.log("");
    console.log(`📚 NO LEARNINGS FOR: ${PROJECT_NAME}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("No learnings stored for this project.");
    console.log("Use 'learning.ts store' to add some.");
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return 0;
  }

  const store = JSON.parse(await readFile(LEARNINGS_FILE, "utf8")) as Store;
  const sortedDesc = [...store.learnings].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );

  let result: Learning[] = [];
  switch (filterType) {
    case "":
    case "help":
    case "-h":
    case "--help":
      console.log(
        "Usage: learning.ts recall [all|category <cat>|search <kw>|recent [n]|project <name>|all-projects]",
      );
      return 0;
    case "all":
      result = sortedDesc.slice(0, limit);
      break;
    case "category":
    case "cat":
      if (!filterValue) return 1;
      result = sortedDesc.filter((l) => l.category === filterValue).slice(0, limit);
      break;
    case "project":
    case "proj":
      result = sortedDesc.slice(0, limit);
      break;
    case "search":
    case "find":
    case "grep": {
      if (!filterValue) return 1;
      const kw = filterValue.toLowerCase();
      result = sortedDesc
        .filter(
          (l) =>
            l.learning.toLowerCase().includes(kw) || (l.context ?? "").toLowerCase().includes(kw),
        )
        .slice(0, limit);
      break;
    }
    case "recent": {
      const n = Number.parseInt(filterValue, 10) || limit;
      result = sortedDesc.slice(0, n);
      break;
    }
    default: {
      const kw = filterType.toLowerCase();
      result = sortedDesc
        .filter(
          (l) =>
            l.learning.toLowerCase().includes(kw) || (l.context ?? "").toLowerCase().includes(kw),
        )
        .slice(0, limit);
    }
  }

  printLearnings(result);
  return 0;
}

async function cmdDelete(id: string): Promise<number> {
  if (!id) {
    console.log("Usage: learning.ts delete <learning_id>");
    return 1;
  }
  if (!existsSync(LEARNINGS_FILE)) {
    console.log("No learnings file found.");
    return 1;
  }
  const store = JSON.parse(await readFile(LEARNINGS_FILE, "utf8")) as Store;
  const before = store.learnings.length;
  store.learnings = store.learnings.filter((l) => l.id !== id);
  if (store.learnings.length === before) {
    console.log(`No learning found with ID: ${id}`);
    return 1;
  }
  await atomicWriteJson(LEARNINGS_FILE, store);
  console.log(`✅ LEARNING DELETED: ${id}`);
  return 0;
}

async function cmdPrune(daysStr = "90"): Promise<number> {
  const days = Number.parseInt(daysStr, 10) || 90;
  if (!existsSync(LEARNINGS_FILE)) {
    console.log(`No learnings file found for project: ${PROJECT_NAME}`);
    return 1;
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const store = JSON.parse(await readFile(LEARNINGS_FILE, "utf8")) as Store;
  const stale = store.learnings.filter((l) => l.timestamp < cutoff);
  if (stale.length === 0) {
    console.log(`✅ NO STALE LEARNINGS (older than ${days} days)`);
    return 0;
  }
  console.log(`🧹 STALE LEARNINGS (older than ${days} days) — ${stale.length} found:`);
  for (const l of stale) console.log(formatLearning(l));
  console.log("To delete: learning.ts delete <id>");
  return 0;
}

function showMainHelp(): void {
  console.log("");
  console.log("📚 LEARNING MANAGEMENT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("Usage: learning.ts <command> [args]");
  console.log("");
  console.log("Commands:");
  console.log("  store <category> <learning> [context]");
  console.log("  recall [all|category|search|recent|project|all-projects] [value] [limit]");
  console.log("  delete <id>");
  console.log("  prune [days]");
  console.log("  list [limit]");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

const [, , cmd = "help", ...args] = process.argv;
switch (cmd) {
  case "store":
  case "add":
  case "save":
    process.exit(await cmdStore(args));
    break;
  case "recall":
  case "query":
  case "search":
  case "find":
  case "get":
    process.exit(await cmdRecall(args));
    break;
  case "delete":
  case "remove":
  case "rm":
    process.exit(await cmdDelete(args[0] ?? ""));
    break;
  case "prune":
  case "stale":
  case "review":
    process.exit(await cmdPrune(args[0]));
    break;
  case "list":
  case "ls":
  case "all":
    process.exit(await cmdRecall(["all", "", args[0] ?? "10"]));
    break;
  default:
    showMainHelp();
}
