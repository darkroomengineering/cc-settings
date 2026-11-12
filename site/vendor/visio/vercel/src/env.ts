import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { call, HASH_VAR, needLocal } from "@visio/env/internal/platform";
import type { EnvPlatform, PushRequest } from "@visio/env/internal/platform";

const API = "https://api.vercel.com";

interface Project {
  projectId: string;
  orgId: string | undefined;
}

function project(request: PushRequest): Project {
  const { local, root } = request;

  if (local.VERCEL_PROJECT_ID) {
    return { projectId: local.VERCEL_PROJECT_ID, orgId: local.VERCEL_ORG_ID };
  }

  const linked = path.join(root, ".vercel/project.json");

  if (existsSync(linked)) {
    // SAFETY: `vercel link` writes this file with these two ids.
    const { projectId, orgId } = JSON.parse(readFileSync(linked, "utf-8")) as {
      projectId?: string;
      orgId?: string;
    };

    if (projectId) {
      return { projectId, orgId };
    }
  }

  return {
    projectId: needLocal(
      local,
      "VERCEL_PROJECT_ID",
      "the id of the Vercel project, from its settings, or run `vercel link`"
    ),
    orgId: local.VERCEL_ORG_ID,
  };
}

interface Created {
  failed?: { error?: { key?: string; message?: string } }[];
}

export const vercelEnv: EnvPlatform = {
  name: "Vercel",
  targets: ["preview", "production"],
  target: (env) => {
    if (env.VERCEL !== "1") {
      return;
    }

    return env.VERCEL_ENV === "production" ? "production" : "preview";
  },
  async push(request) {
    const token = needLocal(
      request.local,
      "VERCEL_TOKEN",
      "a token from vercel.com/account/settings/tokens with access to the project"
    );

    const { projectId, orgId } = project(request);
    const target = [request.target];

    // Encrypted, not sensitive: the build reads the server values for the crawl.
    const body = [
      ...Object.entries(request.server).map(([key, value]) => ({
        key,
        value,
        type: "encrypted",
        target,
      })),
      ...Object.entries({
        ...request.client,
        [HASH_VAR]: request.hash,
      }).map(([key, value]) => ({ key, value, type: "plain", target })),
    ];

    const query = new URLSearchParams({ upsert: "true" });

    // A personal account's id is a user id, which teamId does not take.
    if (orgId?.startsWith("team_")) {
      query.set("teamId", orgId);
    }

    const result = await call<Created>(
      "Vercel",
      `${API}/v10/projects/${encodeURIComponent(projectId)}/env?${query}`,
      { method: "POST", token, body }
    );

    const failed = result?.failed ?? [];

    if (failed.length > 0) {
      throw new Error(
        `[@visio/vercel] [PUSH_FAILED] Vercel did not take ${failed.map((entry) => `${entry.error?.key ?? "?"} (${entry.error?.message ?? "no reason"})`).join(", ")}.`
      );
    }

    return "Vercel applies them to the next deployment: redeploy.";
  },
};
