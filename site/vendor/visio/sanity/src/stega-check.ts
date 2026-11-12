// Dev only: the page a draft session renders, checked for stega marks where
// they break something. See DESIGN.md, Preview.
import type { ServerResponse } from "node:http";

import { VERCEL_STEGA_REGEX, vercelStegaDecode } from "@vercel/stega";
import type { Connect, Logger } from "vite";

import { BYPASS_COOKIE } from "./constants.ts";

/** Attributes that are text a person reads or hears. Marks there are harmless. */
const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "content",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-placeholder",
  "aria-valuetext",
]);

/** Script and style bodies hold the hydration data, where the marks belong. */
const RAW_TEXT =
  /<(?<raw>script|style)\b[^>]*>[\s\S]*?<\/\k<raw>\s*>|<!--[\s\S]*?-->/giu;

// HTML's whitespace, not `\s`: `\s` matches U+FEFF, one of the marks.
const TAG =
  /<(?<tag>[a-zA-Z][\w:-]*)(?<attributes>(?:[ \t\n\f\r]+[^ \t\n\f\r"'>/=]+(?:[ \t\n\f\r]*=[ \t\n\f\r]*(?:"[^"]*"|'[^']*'|[^ \t\n\f\r"'=<>`]+))?)*)[ \t\n\f\r]*\/?>/gu;

const ATTRIBUTE =
  /(?<name>[^ \t\n\f\r"'>/=]+)(?:[ \t\n\f\r]*=[ \t\n\f\r]*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^ \t\n\f\r"'=<>`]+)))?/gu;

const STEGA = new RegExp(VERCEL_STEGA_REGEX.source, "u");
const STEGA_ALL = new RegExp(VERCEL_STEGA_REGEX.source, "gu");

export interface StegaFinding {
  tag: string;
  attribute: string;
  /** The value without the marks. */
  value: string;
  /** The document and field the value came from, when the marks decode. */
  source: string | undefined;
}

/** Where the Studio's edit link inside the marks points: `page "abc", field slug.current`. */
function sourceOf(value: string): string | undefined {
  let decoded: { href?: unknown } | undefined;

  try {
    decoded = vercelStegaDecode(value);
  } catch {
    // Marks that are not a whole payload: the attribute is still reported.
  }

  if (typeof decoded?.href !== "string") {
    return undefined;
  }

  const search = new URL(decoded.href, "http://localhost").searchParams;

  const [type, id, path] = [
    search.get("type"),
    search.get("id"),
    search.get("path"),
  ];

  if (!id || !path) {
    return undefined;
  }

  return `${type ?? "document"} "${id}", field ${path}`;
}

/** Every attribute of `html` whose value carries stega marks, text attributes left out. */
export function findStegaAttributes(html: string): StegaFinding[] {
  const findings: StegaFinding[] = [];
  const markup = html.replaceAll(RAW_TEXT, "");

  for (const { groups: element } of markup.matchAll(TAG)) {
    const tag = element?.tag;
    const attributes = element?.attributes;

    if (!tag || !attributes || !STEGA.test(attributes)) {
      continue;
    }

    for (const { groups: attribute } of attributes.matchAll(ATTRIBUTE)) {
      const name = attribute?.name;

      const value =
        attribute?.double ?? attribute?.single ?? attribute?.bare ?? "";

      if (
        !name ||
        TEXT_ATTRIBUTES.has(name.toLowerCase()) ||
        !STEGA.test(value)
      ) {
        continue;
      }

      findings.push({
        tag: tag.toLowerCase(),
        attribute: name,
        value: value.replaceAll(STEGA_ALL, ""),
        source: sourceOf(value),
      });
    }
  }

  return findings;
}

const SHOWN = 10;

/** The warning for one page, or `undefined` when nothing was found. */
export function stegaWarning(
  path: string,
  findings: StegaFinding[]
): string | undefined {
  if (!findings.length) {
    return undefined;
  }

  const lines = findings.slice(0, SHOWN).map((f) => {
    const value = f.value.length > 60 ? `${f.value.slice(0, 57)}...` : f.value;

    return `  <${f.tag} ${f.attribute}="${value}">${f.source ? ` from ${f.source}` : ""}`;
  });

  if (findings.length > SHOWN) {
    lines.push(`  and ${findings.length - SHOWN} more`);
  }

  return (
    `[@visio/sanity] stega marks in attributes of ${path} (draft mode). ` +
    `These invisible characters break links, ids and classes in the preview. ` +
    `Wrap each value in stegaClean() from @visio/sanity where it becomes an attribute:\n${lines.join(
      "\n"
    )}`
  );
}

type Callback = (error?: Error | null) => void;

type Chunk = string | Uint8Array | null | undefined | Callback;

/** What follows the chunk in `res.write()` and `res.end()`. */
type ChunkRest = [encoding?: BufferEncoding | Callback, callback?: Callback];

/**
 * A dev server middleware: a page rendered for a draft session is kept as it
 * streams out, and checked once it ends. Other requests pass untouched.
 */
export function stegaCheck(
  logger: Pick<Logger, "warn">
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const draft = (req.headers.cookie ?? "").includes(`${BYPASS_COOKIE}=`);

    if (req.method !== "GET" || !draft) {
      return next();
    }

    const chunks: Buffer[] = [];

    function keep(chunk: Chunk, encoding: ChunkRest[0]) {
      if (typeof chunk === "string") {
        chunks.push(
          Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf-8")
        );
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    }

    // SAFETY: each overload of Node's write() and end() takes the chunk, then an encoding or a callback, then a callback.
    const write = res.write as (chunk: Chunk, ...rest: ChunkRest) => boolean;

    // SAFETY: as for write().
    const end = res.end as (
      chunk?: Chunk,
      ...rest: ChunkRest
    ) => ServerResponse;

    res.write = (chunk: Chunk, ...rest: ChunkRest) => {
      keep(chunk, rest[0]);

      return write.call(res, chunk, ...rest);
    };

    res.end = (chunk?: Chunk, ...rest: ChunkRest) => {
      keep(chunk, rest[0]);
      const type = String(res.getHeader("content-type") ?? "");
      const url = req.originalUrl ?? req.url ?? "/";
      const query = url.indexOf("?");
      const path = query === -1 ? url : url.slice(0, query);

      // A check, never a reason for the page to fail.
      try {
        const html = type.includes("text/html")
          ? Buffer.concat(chunks).toString("utf-8")
          : "";

        const warning = stegaWarning(path, findStegaAttributes(html));

        if (warning) {
          logger.warn(warning);
        }
      } catch (error) {
        logger.warn(
          `[@visio/sanity] the stega check of ${path} failed: ${String(error)}`
        );
      }

      return end.call(res, chunk, ...rest);
    };

    next();
  };
}
