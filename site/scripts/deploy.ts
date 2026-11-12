// Builds and deploys the site as a Cloudflare Worker on DOMAIN. The build is
// indexable. Deploying with a domain turns the workers.dev address off.
import { $ } from "bun";

const ACCOUNT = "eef03bc4ed9fcc54e4bc31354a707bc7";

// Proposals, not decisions: confirm the Worker name and the domain before
// the first deploy.
const WORKER = "cc-settings-site";
const DOMAIN = "cc-settings.darkroom.engineering";

const env = {
  ...process.env,
  PUBLIC_SITE_URL: `https://${DOMAIN}`,
  PUBLIC_SITE_INDEXABLE: "true",
};

await $`bun run build`.env(env);

await $`bunx wrangler deploy --name ${WORKER} --domain ${DOMAIN}`.env({
  ...env,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
});
