// Builds the site and deploys it to production as the Vercel project
// cc-settings-site in the Darkroom team, at DOMAIN. The build is indexable.
// darkroom.engineering is a domain of the same team, so the subdomain needs
// no DNS record.
import { $ } from "bun";

const VERCEL = "vercel@65.15.0";
const TEAM = "darkroom-engineering";
const PROJECT = "cc-settings-site";
const DOMAIN = "cc-settings.darkroom.engineering";

const env = {
  ...process.env,
  PUBLIC_SITE_URL: `https://${DOMAIN}`,
  PUBLIC_SITE_INDEXABLE: "true",
};

// The build writes .vercel/output, which the deploy uploads as is.
await $`bun run build`.env(env);

await $`bunx ${VERCEL} deploy --prebuilt --prod --yes --scope ${TEAM} --project ${PROJECT} --create-if-missing`;

// Succeeds when the domain is already on the project, so every deploy runs it.
await $`bunx ${VERCEL} domains add ${DOMAIN} ${PROJECT} --scope ${TEAM}`;
