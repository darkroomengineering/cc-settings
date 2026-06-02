// Stack detector tests. Coverage targets:
//   - each StackKind detected by package.json deps
//   - each StackKind detected by config files when deps absent
//   - precedence (priority order) when multiple signals fire
//   - starter detection from `name` and explicit `darkroom.starter` marker
//   - graceful behavior on missing/malformed package.json
//   - folder-shape tiebreaker when nothing else matches

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeStack, detectStack } from "../src/lib/stack.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-stack-"));
}

async function writePkg(dir: string, content: object): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify(content));
}

describe("stack — package.json detection", () => {
  test("nextjs from `next` dep", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { dependencies: { next: "^16.0.0", react: "19.2.0" } });
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
      expect(s.evidence.some((e) => e.includes("next ^16"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("react-router from `react-router` dep", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { dependencies: { "react-router": "^7.0.0", react: "19.2.0" } });
      const s = await detectStack(dir);
      expect(s.kind).toBe("react-router");
      expect(s.evidence.some((e) => e.includes("react-router"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("react-router from `@react-router/dev` dep", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { devDependencies: { "@react-router/dev": "^7.0.0" } });
      const s = await detectStack(dir);
      expect(s.kind).toBe("react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("react-native wins over plain react", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        dependencies: { "react-native": "^0.76.0", react: "19.2.0" },
      });
      const s = await detectStack(dir);
      expect(s.kind).toBe("react-native");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("tauri from @tauri-apps/api", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { dependencies: { "@tauri-apps/api": "^2.0.0" } });
      const s = await detectStack(dir);
      expect(s.kind).toBe("tauri");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("vite-react fallback only fires without higher-priority signals", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        devDependencies: { vite: "^8.0.0" },
        dependencies: { react: "19.2.0" },
      });
      const s = await detectStack(dir);
      expect(s.kind).toBe("vite-react");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("nextjs takes precedence over vite-react when both present", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        dependencies: { next: "^16.0.0", react: "19.2.0" },
        devDependencies: { vite: "^8.0.0" }, // monorepo with vite tooling
      });
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
      // vite-react should NOT appear in alsoDetected since the fallback
      // never claimed it (Next.js was already detected).
      expect(s.alsoDetected).not.toContain("vite-react");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — config file detection", () => {
  test("next.config.ts triggers nextjs even without package.json dep", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { dependencies: { react: "19.2.0" } });
      await writeFile(join(dir, "next.config.ts"), "export default {}");
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
      expect(s.evidence.some((e) => e.includes("next.config.ts"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("react-router.config.ts triggers react-router", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, { dependencies: { react: "19.2.0" } });
      await writeFile(join(dir, "react-router.config.ts"), "export default {}");
      const s = await detectStack(dir);
      expect(s.kind).toBe("react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("tauri.conf.json triggers tauri", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "src-tauri"), { recursive: true });
      await writeFile(join(dir, "src-tauri", "tauri.conf.json"), "{}");
      const s = await detectStack(dir);
      expect(s.kind).toBe("tauri");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — multi-signal projects", () => {
  test("nextjs + react-router both detected (mid-migration); primary is nextjs", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        dependencies: { next: "^16.0.0", "react-router": "^7.0.0" },
      });
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
      expect(s.alsoDetected).toContain("react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — starter detection", () => {
  test("satus from package.json name", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        name: "@darkroomengineering/satus",
        dependencies: { next: "^16.0.0" },
      });
      const s = await detectStack(dir);
      expect(s.starter).toBe("satus");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("novus from package.json name", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        name: "novus",
        dependencies: { "react-router": "^7.0.0" },
      });
      const s = await detectStack(dir);
      expect(s.starter).toBe("novus");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("explicit darkroom.starter marker overrides name lineage", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        name: "my-renamed-fork",
        darkroom: { starter: "novus" },
        dependencies: { "react-router": "^7.0.0" },
      });
      const s = await detectStack(dir);
      expect(s.starter).toBe("novus");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no starter when none detected", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        name: "some-other-project",
        dependencies: { next: "^16.0.0" },
      });
      const s = await detectStack(dir);
      expect(s.starter).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — folder shape tiebreaker", () => {
  test("RR7 app/root.tsx detected when no other signals", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "app"), { recursive: true });
      await writeFile(join(dir, "app", "root.tsx"), "export default function Root() {}");
      const s = await detectStack(dir);
      expect(s.kind).toBe("react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Next.js app/layout.tsx detected when no other signals", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "app"), { recursive: true });
      await writeFile(join(dir, "app", "layout.tsx"), "export default function Layout() {}");
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("folder shape NOT consulted when package.json gives a verdict", async () => {
    const dir = await sandbox();
    try {
      // Project with a Next.js dep but a misleading app/root.tsx file.
      await writePkg(dir, { dependencies: { next: "^16.0.0" } });
      await mkdir(join(dir, "app"), { recursive: true });
      await writeFile(join(dir, "app", "root.tsx"), "// not actually RR7");
      const s = await detectStack(dir);
      expect(s.kind).toBe("nextjs");
      expect(s.alsoDetected).not.toContain("react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — graceful failure", () => {
  test("missing package.json + empty dir → unknown", async () => {
    const dir = await sandbox();
    try {
      const s = await detectStack(dir);
      expect(s.kind).toBe("unknown");
      expect(s.evidence).toEqual([]);
      expect(s.starter).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed package.json → unknown (no throw)", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "package.json"), "{not valid json");
      const s = await detectStack(dir);
      expect(s.kind).toBe("unknown");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("stack — describeStack formatter", () => {
  test("formats nextjs + satus with no extras", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        name: "satus",
        dependencies: { next: "^16.0.0" },
      });
      const s = await detectStack(dir);
      expect(describeStack(s)).toBe("nextjs (satus starter)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("formats unknown clearly", async () => {
    const dir = await sandbox();
    try {
      const s = await detectStack(dir);
      expect(describeStack(s)).toBe("no framework detected");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("formats multi-stack projects", async () => {
    const dir = await sandbox();
    try {
      await writePkg(dir, {
        dependencies: { next: "^16.0.0", "react-router": "^7.0.0" },
      });
      const s = await detectStack(dir);
      expect(describeStack(s)).toContain("nextjs");
      expect(describeStack(s)).toContain("also: react-router");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
