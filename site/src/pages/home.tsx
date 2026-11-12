import type { Meta } from "@visio/router";
import { absoluteUrl, defineRoute } from "@visio/router";
import { css, dp, GRID } from "@visio/styling";

import { CopyCommand } from "../components/copy-command";
import {
  CURL_COMMAND,
  INSTALL_DOCS,
  NAME,
  NPX_COMMAND,
  REPO,
} from "../lib/product";
import { t } from "../styles/tokens";

// The first paragraph of the README.
const PITCH =
  "cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows, safety checks, and proof gates. One installer makes a new machine behave like the rest of the team without replacing personal configuration that cc-settings does not own.";

const DESCRIPTION =
  "cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows, safety checks and proof gates. Install it with npx darkroom-settings.";

export const route = defineRoute("/", {
  meta: (): Meta => ({
    title: "cc-settings: Darkroom's setup for Claude Code and Codex",
    description: DESCRIPTION,
    social: {
      title: NAME,
      description:
        "The Darkroom engineering team's standards, workflows and safety checks for Claude Code and Codex.",
    },
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: NAME,
        url: absoluteUrl("/"),
        description: DESCRIPTION,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        softwareRequirements: "Claude Code or Codex CLI",
        installUrl: INSTALL_DOCS,
        image: absoluteUrl("/og.png"),
        license: "https://opensource.org/licenses/MIT",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Coding standards and guardrails every tool reads",
          "23 skills: fix, build, review, ship, audit and more",
          "9 role agents",
          "22 hooks that block destructive commands and inject context",
          "Rollback and uninstall that leave your own configuration alone",
        ],
        publisher: {
          "@type": "Organization",
          name: "Darkroom Engineering",
          url: "https://darkroom.engineering",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: NAME,
        url: absoluteUrl("/"),
      },
    ],
  }),
});

const s = css({
  wrap: {
    maxInlineSize: t.layout.frame,
    marginInline: "auto",
    paddingInline: t.layout.safe,
  },
  hero: {
    display: "grid",
    rowGap: dp(20),
    paddingBlockStart: dp(48),
    paddingBlockEnd: dp(48),
    desktop: {
      rowGap: dp(28),
      paddingBlockStart: dp(96),
      paddingBlockEnd: dp(72),
    },
  },
  name: {
    ...t.type.display,
  },
  pitch: {
    ...t.type.lead,
    maxInlineSize: t.sizes.measure,
    color: t.colors.dim,
  },
  install: {
    display: "grid",
    rowGap: dp(16),
    maxInlineSize: dp(760),
  },
  method: {
    display: "grid",
    rowGap: dp(8),
  },
  methodTitle: {
    ...t.type.note,
    color: t.colors.dim,
  },
  note: {
    ...t.type.note,
    maxInlineSize: t.sizes.measure,
    color: t.colors.dim,
  },
  link: {
    color: t.colors.ink,
    textDecorationLine: "underline",
    textUnderlineOffset: "0.2em",
    hover: { color: t.colors.accent },
    ":active": { color: t.colors.accent },
  },
  features: {
    paddingBlockEnd: dp(40),
  },
  feature: {
    display: "grid",
    rowGap: dp(16),
    paddingBlock: dp(32),
    borderBlockStartWidth: "1px",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: t.colors.rule,
    desktop: {
      ...GRID,
      paddingBlock: dp(48),
    },
  },
  featureTitle: {
    ...t.type.title,
    desktop: { gridColumn: "span 5" },
  },
  featureList: {
    display: "grid",
    rowGap: dp(8),
    paddingInlineStart: dp(20),
    color: t.colors.dim,
    desktop: { gridColumn: "span 7" },
  },
  said: {
    color: t.colors.ink,
  },
});

export default function Home() {
  return (
    <>
      <header class={s.wrap}>
        <div class={s.hero}>
          <h1 class={s.name}>{NAME}</h1>
          <p class={s.pitch}>{PITCH}</p>
          <div class={s.install}>
            <div class={s.method}>
              <h2 class={s.methodTitle}>Any platform (Node 18+)</h2>
              <CopyCommand command={NPX_COMMAND} label="the npx command" />
            </div>
            <div class={s.method}>
              <h2 class={s.methodTitle}>macOS or Linux, without Node</h2>
              <CopyCommand command={CURL_COMMAND} label="the curl command" />
            </div>
          </div>
          <p class={s.note}>
            Install and sign in to Claude Code, Codex CLI, or both first:
            cc-settings configures them and does not include a subscription.
            Restart them after the install. Windows PowerShell, every installer
            flag and how to undo it are in the{" "}
            <a class={s.link} href={INSTALL_DOCS}>
              installation reference
            </a>
            . Free and open source under MIT,{" "}
            <a class={s.link} href={REPO}>
              on GitHub
            </a>
            .
          </p>
        </div>
      </header>

      <div class={s.wrap}>
        <div class={s.features}>
          <section class={s.feature}>
            <h2 class={s.featureTitle}>
              The same request, done the team's way
            </h2>
            <ul class={s.featureList}>
              <li>
                <span class={s.said}>"Fix this bug"</span> reproduces first,
                names the cause before the fix, keeps the change inside the
                bug's scope, and runs the real tests afterwards.
              </li>
              <li>
                <span class={s.said}>"Review my changes"</span> stays read-only,
                checks the diff against the team checklist, and reports by
                severity.
              </li>
              <li>
                <span class={s.said}>"Ship it"</span> runs the repository's own
                type check, build, tests and lint, opens the PR in the house
                style, and watches CI.
              </li>
            </ul>
          </section>

          <section class={s.feature}>
            <h2 class={s.featureTitle}>What it installs</h2>
            <ul class={s.featureList}>
              <li>
                Coding standards and guardrails every tool reads, twelve topic
                rules, and six stack profiles.
              </li>
              <li>
                23 skills, named workflows picked from plain language: fix,
                build, review, ship, audit, handoff and the rest.
              </li>
              <li>
                9 role agents, so big work is split between a planner, explorer,
                implementer, tester, reviewer and others.
              </li>
              <li>
                22 hooks on 16 lifecycle events. They block destructive commands
                such as <code>rm -rf</code>, and a permission rule denies a
                force push to main.
              </li>
            </ul>
          </section>

          <section class={s.feature}>
            <h2 class={s.featureTitle}>What it leaves alone</h2>
            <ul class={s.featureList}>
              <li>
                Your login and subscription, your permission mode, your personal
                memory, and any setting the installer does not own.
              </li>
              <li>
                Your own global instructions in{" "}
                <code>~/.claude/personal.md</code>, which setup never replaces.
              </li>
              <li>
                The installer records what it owns and keeps a backup per
                product, so it can preview, roll back or uninstall.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
