import { createContext, runInContext } from "node:vm";

import type { PrerenderIntegration } from "prerender-crawler/vite";

export interface BoundaryReport {
  /** Boundaries whose placeholder is in the document and whose content never arrived. */
  unresolved: string[];
  /** Boundaries the render completed with an error instead of content. */
  errored: string[];
}

const SCRIPT = /<script(?:\s[^>]*)?>(?<code>[\s\S]*?)<\/script>/gv;

/** The boundaries whose `_fr` promise the hydration data rejects (DESIGN.md, Prerender). */
function rejectedFragments(html: string): string[] {
  const sandbox = createContext({});
  // A rejection the browser would hand to the boundary has no handler here,
  // and the build process would report it as unhandled.
  runInContext(
    `self = globalThis;
    _$HY = { r: {} };
    const Base = Promise;
    Promise = class extends Base {
      static get [Symbol.species]() { return Base; }
      constructor(executor) { super(executor); this.catch(() => {}); }
    };`,
    sandbox
  );

  for (const match of html.matchAll(SCRIPT)) {
    const code = match.groups?.code;

    if (code === undefined) {
      throw new Error("SCRIPT always captures the script's code.");
    }

    if (!code.includes("_$HY.r[")) {
      continue;
    }

    try {
      runInContext(code, sandbox, { timeout: 1000 });
    } catch {
      // A stream's swap scripts call `$df()`, which only the browser has.
    }
  }

  // SAFETY: the setup script above made `_$HY.r` an object, and the
  // hydration data only adds records to it.
  const data = runInContext("_$HY.r", sandbox) as Record<
    string,
    { s?: number } | undefined
  >;

  return Object.keys(data)
    .filter((key) => key.endsWith("_fr") && data[key]?.s === 2)
    .map((key) => key.slice(0, -"_fr".length));
}

/**
 * Reads a rendered page for its boundaries. A pending boundary leaves
 * `<template id="pl-KEY">` in the document; a stream later appends
 * `<template id="KEY">` with the content, or with a single space when the
 * boundary threw and nothing above it caught the error.
 */
export function inspectBoundaries(html: string): BoundaryReport {
  const report: BoundaryReport = { unresolved: [], errored: [] };

  for (const match of html.matchAll(/<template id="pl-(?<key>[^"]+)"/gv)) {
    const key = match.groups?.key;

    if (key === undefined) {
      throw new Error("The placeholder pattern always captures a key.");
    }

    const at = html.indexOf(`<template id="${key}">`);

    if (at === -1) {
      report.unresolved.push(key);
    } else if (
      html.startsWith(" </template>", at + `<template id="${key}">`.length)
    ) {
      report.errored.push(key);
    }
  }

  for (const key of rejectedFragments(html)) {
    if (!report.errored.includes(key)) {
      report.errored.push(key);
    }
  }

  return report;
}

function describe(path: string, report: BoundaryReport): string | undefined {
  const parts: string[] = [];

  if (report.unresolved.length) {
    parts.push(
      `${report.unresolved.length} boundar${report.unresolved.length === 1 ? "y" : "ies"} never resolved (${report.unresolved.join(", ")})`
    );
  }

  if (report.errored.length) {
    parts.push(
      `${report.errored.length} boundar${report.errored.length === 1 ? "y" : "ies"} errored (${report.errored.join(", ")})`
    );
  }

  return parts.length ? `  ${path}: ${parts.join("; ")}` : undefined;
}

/**
 * Fails the crawl when a rendered page has a `<Loading>` boundary that
 * never completed, or completed with an error, naming each page and
 * boundary. Runs in `teardown`, so every page has rendered by then and one
 * message lists them all.
 */
export function boundaryGuard(): PrerenderIntegration {
  return {
    name: "visio:boundaries",
    teardown(context) {
      const lines: string[] = [];

      for (const page of context.pages) {
        if (page.redirect) {
          continue;
        }

        const line = describe(page.path, inspectBoundaries(page.html));

        if (line) {
          lines.push(line);
        }
      }

      if (!lines.length) {
        return;
      }

      throw new Error(
        `[@visio/router] ${lines.length} page(s) were written without the content of a <Loading> boundary:\n${lines.join("\n")}\n` +
          "The response was a 200, so the crawler wrote the page as it was. " +
          "A boundary that never resolves usually reads a query() that was already settled before the render began, " +
          "such as one called from a start.serverRenderSetup hook or middleware; let the route preload start it instead. " +
          "A boundary that errored threw during the render, and the server writes it empty even inside an <Errored>: put the <Errored> inside the <Loading>, or keep the read from failing. Run the page on the dev server for the error."
      );
    },
  };
}
