#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";

import { smoke, smokeArgs } from "../src/smoke/smoke.ts";

const { app, url, port, only } = smokeArgs(process.argv.slice(2));
const root = process.cwd();

const dir = path.resolve(
  root,
  app ?? (existsSync(path.join(root, "site", "vite.config.ts")) ? "site" : ".")
);

process.exit(await smoke({ root, dir, url, port, only, site: true }));
