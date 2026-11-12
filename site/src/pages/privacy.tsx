import { defineRoute } from "@visio/router";
import { css } from "@visio/styling";

import { Prose } from "../components/prose";
import { ISSUES, NAME } from "../lib/product";
import { t } from "../styles/tokens";

export const route = defineRoute("/privacy", {
  meta: () => ({
    title: `Privacy policy · ${NAME}`,
    description:
      "cc-settings has no analytics and no server of its own. It installs configuration on your machine; the services it connects to are the ones you choose.",
  }),
});

const s = css({
  // Links inside a sentence, which the 44px target rule exempts.
  link: {
    textDecorationLine: "underline",
    textUnderlineOffset: "0.2em",
    hover: { color: t.colors.accent },
    ":active": { color: t.colors.accent },
  },
});

export default function Privacy() {
  return (
    <Prose title="cc-settings privacy policy">
      <p>
        cc-settings is configuration that runs on your machine. It has no
        analytics, and Darkroom Engineering runs no server for it and receives
        nothing from it.
      </p>
      <p>
        <strong>Installing and updating.</strong> The installer downloads
        cc-settings from its GitHub repository, and <code>npx</code> first
        downloads the small installer package from the npm registry. If you turn
        on auto-update on macOS, a daily job does the same check against GitHub.
      </p>
      <p>
        <strong>On your machine.</strong> Hooks keep logs, backups and install
        state under your home folder, such as <code>~/.claude</code>. They stay
        there.
      </p>
      <p>
        <strong>Claude Code and Codex.</strong> Your prompts and code go to
        Anthropic or OpenAI through those products, under their own terms.
        cc-settings does not change where they send data.
      </p>
      <p>
        <strong>Connected tools.</strong> cc-settings configures MCP servers
        that you sign in to: Context7 receives the library documentation
        questions an agent asks, and Figma receives requests for the files you
        point it at. Team notes you share with <code>/share-learning</code> go
        to a GitHub repository through your own GitHub CLI sign-in.
      </p>
      <p>
        <strong>Optional services.</strong> If you add a TypeSafe key, verbatim
        compaction and the drift check send session content to TypeSafe's API to
        score it; without a key nothing goes there. The Codex bridge hands work
        to your own Codex CLI only when you have installed and signed in to it.
      </p>
      <p>
        Questions:{" "}
        <a class={s.link} href={ISSUES}>
          open an issue on GitHub
        </a>
        .
      </p>
      <p>Last updated: November 12, 2026.</p>
    </Prose>
  );
}
