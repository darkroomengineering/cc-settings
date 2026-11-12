// Imports no Node module: the server bundle takes it for the live llms.txt.
import { markdownPath } from "./paths.ts";

/** A page of `llms.txt`: its title and description from its head. */
export interface LlmsPage {
  path: string;
  title?: string | undefined;
  description?: string | undefined;
}

export interface LlmsOptions {
  /** The public origin, for absolute links. */
  hostname?: string | undefined;
  /** The `# heading`. Default: the home page's title. */
  name?: string | undefined;
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

function linkText(text: string): string {
  return oneLine(text).replaceAll(/[[\]\\]/gu, "\\$&");
}

/** Home first, then by path. */
function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path === "/") {
    return -1;
  }

  if (b.path === "/") {
    return 1;
  }

  return a.path.localeCompare(b.path);
}

/** `llms.txt` of these pages, the home page's title and description for its heading. */
export function llmsText(
  pages: readonly LlmsPage[],
  options: LlmsOptions
): string {
  const listed = pages.toSorted(byPath);
  const home = listed.find((p) => p.path === "/");

  function link(pathname: string): string {
    return options.hostname
      ? new URL(markdownPath(pathname), options.hostname).href
      : markdownPath(pathname);
  }

  const lines = [`# ${oneLine(options.name || home?.title || "Site")}`];

  if (home?.description) {
    lines.push("", `> ${oneLine(home.description)}`);
  }

  lines.push("", "## Pages", "");

  for (const { path: pathname, title, description } of listed) {
    lines.push(
      `- [${linkText(title ?? pathname)}](${link(pathname)})${description ? `: ${oneLine(description)}` : ""}`
    );
  }

  return `${lines.join("\n")}\n`;
}
