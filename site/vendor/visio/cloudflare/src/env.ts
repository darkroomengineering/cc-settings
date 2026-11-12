import { call, HASH_VAR, needLocal } from "@visio/env/internal/platform";
import type { EnvPlatform } from "@visio/env/internal/platform";
import { previewBranch, PRODUCTION_BRANCH } from "visio/internal/deploy";

const API = "https://api.cloudflare.com/client/v4";

interface Envelope<T> {
  result: T;
}

interface Trigger {
  trigger_uuid: string;
  branch_includes?: string[];
}

export const cloudflareEnv: EnvPlatform = {
  name: "Cloudflare",
  targets: ["production"],
  target: (env) => {
    if (env.WORKERS_CI !== "1") {
      return;
    }

    return previewBranch(env) ? "preview" : "production";
  },
  async push(request) {
    if (request.target === "preview") {
      throw new Error(
        "[@visio/cloudflare] [TARGET_NOT_BUILT] the push to Cloudflare previews is not built yet: Worker Previews keep their own secrets. Set each one with `wrangler preview base-config secret put NAME`, and the build variables in the dashboard."
      );
    }

    const { local } = request;

    const token = needLocal(
      local,
      "CLOUDFLARE_API_TOKEN",
      "a token with Workers Scripts Edit and Workers CI Edit"
    );

    const account = needLocal(
      local,
      "CLOUDFLARE_ACCOUNT_ID",
      "the account id, from the dashboard's Workers overview"
    );

    const worker = needLocal(
      local,
      "CLOUDFLARE_WORKER_NAME",
      "the name of the Worker in the dashboard"
    );

    const base = `${API}/accounts/${encodeURIComponent(account)}`;

    // Workers Builds keeps its build variables apart from the Worker's secrets,
    // and the build reads every value: the crawl needs the server ones too.
    const scripts = await call<Envelope<{ id: string; tag?: string }[]>>(
      "Cloudflare",
      `${base}/workers/scripts`,
      { method: "GET", token }
    );

    const tag = scripts.result.find((script) => script.id === worker)?.tag;

    if (!tag) {
      throw new Error(
        `[@visio/cloudflare] [PUSH_FAILED] Cloudflare has no Worker named ${JSON.stringify(worker)} in account ${account}. Deploy it once, or fix CLOUDFLARE_WORKER_NAME.`
      );
    }

    const triggers = await call<Envelope<Trigger[]>>(
      "Cloudflare",
      `${base}/builds/workers/${encodeURIComponent(tag)}/triggers`,
      { method: "GET", token }
    );

    const branch = local.VISIO_PRODUCTION_BRANCH || PRODUCTION_BRANCH;

    const production = triggers.result.filter((trigger) =>
      trigger.branch_includes?.includes(branch)
    );

    if (production.length === 0) {
      throw new Error(
        `[@visio/cloudflare] [PUSH_FAILED] the Worker ${worker} has no Workers Builds trigger for the branch ${branch}. Connect the repository in the dashboard, or declare VISIO_PRODUCTION_BRANCH in the server block of src/env.ts and set it in .env.production, so the push sends it to the build as well.`
      );
    }

    const variables = Object.fromEntries([
      ...Object.entries(request.server).map(([key, value]) => [
        key,
        { value, is_secret: true },
      ]),
      ...Object.entries({ ...request.client, [HASH_VAR]: request.hash }).map(
        ([key, value]) => [key, { value, is_secret: false }]
      ),
    ]);

    await Promise.all(
      production.map((trigger) =>
        call(
          "Cloudflare",
          `${base}/builds/triggers/${encodeURIComponent(trigger.trigger_uuid)}/environment_variables`,
          { method: "PATCH", token, body: variables }
        )
      )
    );

    await call(
      "Cloudflare",
      `${base}/workers/scripts/${encodeURIComponent(worker)}/secrets-bulk`,
      {
        method: "PATCH",
        token,
        body: {
          secrets: Object.fromEntries(
            Object.entries(request.server).map(([name, text]) => [
              name,
              { name, text, type: "secret_text" },
            ])
          ),
        },
      }
    );

    return "Cloudflare deployed the secrets to the running Worker now; the build variables apply from the next build.";
  },
};
