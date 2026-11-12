#!/usr/bin/env node
const { main } = await import("../src/cli.ts");

process.exit(await main());
