import { useLocation } from "@solidjs/router";
import type {
  Location,
  Params,
  RouteParams,
  RoutePreloadFuncArgs,
} from "@solidjs/router";
import { httpStatus, isDev, isServer, useHead } from "@solidjs/web";
import type { HeadTag } from "@solidjs/web";
import { createMemo, latest, NotReadyError, untrack } from "solid-js";
import type { Accessor } from "solid-js";

import { announce } from "./announce.ts";
import { matchChain } from "./chain.ts";
import type { RouterLike } from "./chain.ts";
import type {
  HeadFields,
  MetaExtension,
  RouteArgsExtension,
  RouterExtension,
  TableEntry,
} from "./extend.ts";
import { extensionArgs, extensionHead, extensionStates } from "./extensions.ts";

/** The social image with its size and alt text, for `og:image:*`. */
export interface MetaImage {
  /** Absolute URL, or a path resolved against `PUBLIC_SITE_URL`. */
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** The head tags a page declares, and the fields of the site's extensions. */
export interface Meta extends MetaExtension {
  title: string;
  description?: string;
  /** Absolute URL of the canonical page; also `og:url`. */
  canonical?: string;
  /**
   * The social image: an absolute URL or a path resolved against
   * `PUBLIC_SITE_URL`, or one with its size and alt text.
   */
  image?: string | MetaImage;
  /** `og:type`: `website` for most pages, `article` for a post. */
  type?: "website" | "article";
  /** When the content last changed, ISO 8601: `article:modified_time` and the sitemap's `lastmod`. */
  modified?: string;
  /** Keeps the page out of search indexes. */
  noindex?: boolean;
  /**
   * What link previews show when it differs from the page's own title and
   * description: a CMS's "share title" and "share text". Feeds `og:title`,
   * `og:description`, `twitter:title` and `twitter:description`.
   */
  social?: { title?: string; description?: string };
  /** Structured data: one `application/ld+json` script per object. */
  jsonLd?: object | readonly object[];
  /** More `<meta>` tags, such as a verification code from the CMS. */
  tags?: readonly MetaTag[];
}

/** One extra `<meta>` tag of a page, identified by its name or property. */
export type MetaTag =
  | { name: string; content: string }
  | { property: string; content: string };

/**
 * A preload's return as `meta` receives it: a promise awaited, a plain
 * object with promise-valued properties awaited together, anything else as
 * it is.
 */
export type Settled<T> =
  T extends PromiseLike<infer U>
    ? U
    : T extends readonly unknown[]
      ? T
      : T extends object
        ? { [K in keyof T]: Awaited<T[K]> }
        : T;

/** A page's meta with what only the site sets. */
export interface HeadMeta extends Meta {
  siteName?: string;
  locale?: string;
  /** The extensions' own tags. */
  added?: readonly HeadTag[];
  /** An extension found that the page does not exist: status 404. */
  notFound?: boolean;
  announce?: readonly string[];
}

/**
 * What every page's head starts from: the site's origin, name, locale and
 * default social image. `visio()` defines them from its `site` option.
 */
export interface SiteMeta {
  /** The public origin, `https://example.com`. */
  url?: string | undefined;
  /** `og:site_name` of every page. */
  name?: string | undefined;
  /** `og:locale` of every page, such as `de_DE`. */
  locale?: string | undefined;
  /** The social image for pages that do not set their own; a path resolves against `url`. */
  image?: string | MetaImage | undefined;
}

/**
 * The site facts `visio()` defined for this build; empty without it. Each
 * read is spelled out in full, since the define replaces only that text.
 * The casts are for Bun's types, where every env value is a string.
 */
function definedSite(): SiteMeta {
  const image: unknown = import.meta.env.SITE_IMAGE;

  return {
    url: import.meta.env.SITE_URL || undefined,
    name: import.meta.env.SITE_NAME || undefined,
    locale: import.meta.env.SITE_LOCALE || undefined,
    // SAFETY: visio() defines SITE_IMAGE from `site.image`, a string or a MetaImage, or null.
    image: (image as string | MetaImage | null) ?? undefined,
  };
}

// SAFETY: `satisfies` checks that the object has exactly the router's keys of Meta; an extension reads its own from meta().
const META_KEYS = Object.keys({
  title: true,
  description: true,
  canonical: true,
  image: true,
  type: true,
  modified: true,
  noindex: true,
  social: true,
  jsonLd: true,
  tags: true,
} satisfies Record<
  Exclude<keyof Meta, keyof MetaExtension>,
  true
>) as (keyof Meta)[];

/** `path` against `origin`; without one, the path as it is. Exported for tests. */
export function resolveUrl(path: string, origin?: string): string {
  return origin ? new URL(path, origin).href : path;
}

/**
 * A path, or a `paths.x()` result, as an absolute URL on the site's origin
 * (`PUBLIC_SITE_URL`), for JSON-LD and anything else that must not be
 * relative. Without the origin it returns the path.
 */
export function absoluteUrl(path: string): string {
  return resolveUrl(path, definedSite().url);
}

function pick<T, K extends keyof T>(from: T, keys: readonly K[]): Pick<T, K> {
  // SAFETY: the loop sets every key of `keys`.
  const out = {} as Pick<T, K>;

  for (const key of keys) {
    out[key] = from[key];
  }

  return out;
}

/**
 * A page's meta over the site's defaults. With the origin known, a page
 * without a canonical gets its own address (the path, no query), and a
 * relative image URL, such as an imported asset, becomes absolute, which
 * link previews require. A `noindex` page gets no canonical: it names no
 * address to index. Exported for tests.
 */
export function withSiteDefaults(
  meta: Meta,
  site: SiteMeta,
  pathname?: string,
  fields: HeadFields = {}
): HeadMeta {
  function absolute(url: string): string {
    return resolveUrl(url, site.url);
  }

  // Only the fields a page declares: a `siteName` or `locale` smuggled past
  // the type would otherwise reach `og:site_name` or `og:locale`.
  const out: HeadMeta = pick(meta, META_KEYS);

  if (site.name) {
    out.siteName = site.name;
  }

  const locale = fields.locale ?? site.locale;

  if (locale) {
    out.locale = locale;
  }

  out.noindex ||= fields.noindex;
  const image = out.image ?? site.image;

  if (image) {
    out.image = isUrl(image)
      ? absolute(image)
      : { ...image, url: absolute(image.url) };
  }

  if (!out.canonical && !out.noindex && site.url && pathname !== undefined) {
    out.canonical = absolute(pathname);
  }

  return out;
}

export interface MetaArgs<
  P extends string = string,
  T = unknown,
> extends RouteArgsExtension {
  params: RouteParams<P>;
  location: Location;
  /**
   * What the route's `preload` returned, settled (see `Settled`); undefined
   * on the client when the preload rejected.
   */
  data: Settled<T> | undefined;
}

function isUrl(image: string | MetaImage): image is string {
  return typeof image === "string";
}

export function isThenable<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function isPlainObject<T>(value: T): value is T & object {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const proto: unknown = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

async function settleEntries<T>(
  entries: readonly (readonly [string, unknown])[]
): Promise<Settled<T>> {
  const settled = await Promise.all(
    entries.map(async ([k, v]) => [k, await v] as const)
  );

  // SAFETY: the entries are T's properties, so awaited they are Settled<T>.
  return Object.fromEntries(settled) as Settled<T>;
}

/** Settles a preload's return; see `Settled`. Synchronous when nothing is pending. */
export function settle<T>(value: T): Settled<T> | PromiseLike<Settled<T>> {
  if (isThenable(value)) {
    // SAFETY: Settled<T> of a thenable is what it resolves to.
    return value as PromiseLike<Settled<T>>;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);

    if (entries.some(([, v]) => isThenable(v))) {
      return settleEntries<T>(entries);
    }
  }

  // SAFETY: nothing is pending, and Settled<T> of such a value is T.
  return value as Settled<T>;
}

function tag(
  name: HeadTag["tag"],
  props: Record<string, string>,
  key?: string
): HeadTag {
  return key === undefined ? { tag: name, props } : { tag: name, props, key };
}

const OWN_TAGS = new Map([
  ["description", "`description`"],
  ["og:title", "`title` or `social.title`"],
  ["twitter:title", "`social.title`"],
  ["og:description", "`description` or `social.description`"],
  ["twitter:description", "`social.description`"],
  ["og:type", "`type`"],
  ["og:url", "`canonical`"],
  ["og:image", "`image`"],
  ["og:image:width", "`image.width`"],
  ["og:image:height", "`image.height`"],
  ["og:image:alt", "`image.alt`"],
  ["og:site_name", "`site.name` of visio() in vite.config.ts"],
  ["og:locale", "`site.locale` of visio() in vite.config.ts"],
]);

const warnedTags = new Set<string>();

function idOf(extra: MetaTag): string {
  return "name" in extra ? extra.name : extra.property;
}

const NOINDEX_RE = /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/iv;

/** The page's extra tags, without the ones a field of `Meta` owns (DESIGN.md, Meta). */
function extraTags(tags: readonly MetaTag[], dev: boolean): MetaTag[] {
  return tags.filter((extra) => {
    const id = idOf(extra);
    const field = OWN_TAGS.get(id.trim().toLowerCase());

    if (field === undefined) {
      return true;
    }

    if (dev && !warnedTags.has(id)) {
      warnedTags.add(id);
      console.warn(
        `[@visio/router] [META_TAG_RESERVED] meta() returns ${JSON.stringify(id)} in \`tags\`, but the router writes that tag itself, and the page would have two. Set ${field} instead.`
      );
    }

    return false;
  });
}

/** The title, description, type, site and canonical tags, social ones included. */
function textTags(meta: HeadMeta): HeadTag[] {
  const socialTitle = meta.social?.title ?? meta.title;
  const socialDescription = meta.social?.description ?? meta.description;

  const tags: HeadTag[] = [
    tag("title", { children: meta.title }),
    tag("meta", { property: "og:title", content: socialTitle }),
  ];

  if (meta.social?.title) {
    tags.push(tag("meta", { name: "twitter:title", content: socialTitle }));
  }

  if (meta.type) {
    tags.push(tag("meta", { property: "og:type", content: meta.type }));
  }

  if (meta.siteName) {
    tags.push(
      tag("meta", { property: "og:site_name", content: meta.siteName })
    );
  }

  if (meta.locale) {
    tags.push(tag("meta", { property: "og:locale", content: meta.locale }));
  }

  if (meta.description) {
    tags.push(tag("meta", { name: "description", content: meta.description }));
  }

  if (meta.modified) {
    tags.push(
      tag("meta", { property: "article:modified_time", content: meta.modified })
    );
  }

  if (socialDescription) {
    tags.push(
      tag("meta", { property: "og:description", content: socialDescription })
    );

    if (meta.social?.description) {
      tags.push(
        tag("meta", { name: "twitter:description", content: socialDescription })
      );
    }
  }

  if (meta.canonical) {
    // Keyed, because the head identifies a link by its href: without the
    // key, the next page's canonical would join the last one instead of
    // replacing it.
    tags.push(
      tag("link", { rel: "canonical", href: meta.canonical }, "canonical"),
      tag("meta", { property: "og:url", content: meta.canonical })
    );
  }

  return tags;
}

function imageTags(metaImage: string | MetaImage | undefined): HeadTag[] {
  if (!metaImage) {
    return [];
  }

  const image = isUrl(metaImage) ? { url: metaImage } : metaImage;
  const tags = [tag("meta", { property: "og:image", content: image.url })];

  if (image.width !== undefined) {
    tags.push(
      tag("meta", {
        property: "og:image:width",
        content: String(image.width),
      })
    );
  }

  if (image.height !== undefined) {
    tags.push(
      tag("meta", {
        property: "og:image:height",
        content: String(image.height),
      })
    );
  }

  if (image.alt) {
    tags.push(tag("meta", { property: "og:image:alt", content: image.alt }));
  }

  return tags;
}

/** `twitter:card`, `robots`, and the page's extra tags. */
function extraHeadTags(meta: HeadMeta, dev: boolean): HeadTag[] {
  const tags: HeadTag[] = [];
  const extras = extraTags(meta.tags ?? [], dev);

  function own(id: string): MetaTag | undefined {
    return extras.find((e) => idOf(e).trim().toLowerCase() === id);
  }

  if (meta.image && !own("twitter:card")) {
    tags.push(
      tag("meta", { name: "twitter:card", content: "summary_large_image" })
    );
  }

  // SAFETY: visio() defines SITE_INDEXABLE as a boolean literal, and Bun
  // types every env value as a string. False marks every page noindex.
  const indexable = import.meta.env.SITE_INDEXABLE as boolean | undefined;
  const noindex = meta.noindex || indexable === false;
  const robots = own("robots");

  if (noindex && !(robots && NOINDEX_RE.test(robots.content))) {
    tags.push(tag("meta", { name: "robots", content: "noindex" }));
  }

  for (const extra of extras) {
    if (extra === robots && noindex && !NOINDEX_RE.test(extra.content)) {
      continue;
    }

    tags.push(
      tag(
        "meta",
        "name" in extra
          ? { name: extra.name, content: extra.content }
          : { property: extra.property, content: extra.content }
      )
    );
  }

  return tags;
}

function jsonLdTags(jsonLd: Meta["jsonLd"]): HeadTag[] {
  if (!jsonLd) {
    return [];
  }

  const objects = Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  return objects.map((object, i) => {
    // `<` never appears raw, so `</script>` inside a value cannot end the tag.
    const json = JSON.stringify(object).replaceAll("<", "\\u003c");

    return tag(
      "script",
      { type: "application/ld+json", children: json },
      `ld+json:${i}`
    );
  });
}

/**
 * The head tags for a page's meta, each identified by name or property so
 * the next page's tag replaces it. Exported for tests.
 */
export function headTags(meta: HeadMeta, dev = isDev): HeadTag[] {
  return [
    ...textTags(meta),
    ...imageTags(meta.image),
    ...extraHeadTags(meta, dev),
    ...jsonLdTags(meta.jsonLd),
    ...(meta.added ?? []),
  ];
}

/**
 * Keyed, since the head identifies a link by its href. The links are the
 * attributes `visio()` defines (`IconLink` in visio). Exported for tests.
 */
export function iconTags(links = definedIcons()): HeadTag[] {
  return (links ?? []).map((link, i) => tag("link", { ...link }, `icon:${i}`));
}

function definedIcons(): readonly Record<string, string>[] | null | undefined {
  const icons: unknown = import.meta.env.VISIO_ICONS;

  // SAFETY: visio() defines VISIO_ICONS as a list of link attributes, or null.
  return icons as readonly Record<string, string>[] | null | undefined;
}

const FAILED = Symbol("failed preload");

async function orFailed<T>(promise: Promise<T>): Promise<T | typeof FAILED> {
  try {
    return await promise;
  } catch {
    return FAILED;
  }
}

/** The page's table entry and the site's extensions, for their `head`. */
export interface ExtendedPage {
  entry: TableEntry;
  extensions: readonly RouterExtension[];
}

/**
 * The page's meta over the site's defaults and the extensions' head
 * fields. On the client a throw gives
 * undefined, and the page registers no head tags, so its own tags go: the
 * memo that calls this sits outside every boundary, where an error halts
 * the app. The server keeps the error. Exported for tests.
 */
export function resolveMeta(
  meta: (args: MetaArgs) => Meta,
  args: MetaArgs,
  site: SiteMeta,
  client = !isServer,
  extended?: ExtendedPage
): HeadMeta | undefined {
  try {
    const own = meta(args);

    if (!extended) {
      return withSiteDefaults(own, site, args.location.pathname);
    }

    const added = extensionHead(extended.extensions, extended.entry, args);

    const head = withSiteDefaults(own, site, args.location.pathname, {
      ...added.fields,
      noindex: added.notFound || added.fields.noindex,
    });

    head.notFound = added.notFound;
    head.announce = added.announce;

    // A page not to index names no other address of itself either.
    const kept = head.noindex ? added.always : [...added.tags, ...added.always];

    if (kept.length > 0) {
      head.added = kept;
    }

    return head;
  } catch (error) {
    if (!client || error instanceof NotReadyError) {
      throw error;
    }

    if (isDev) {
      console.warn(
        `[@visio/router] meta() threw for ${args.location.pathname}; the page has no head tags until it returns.`,
        error
      );
    }

    return undefined;
  }
}

// oxlint-disable-next-line no-empty-function -- a render that matched no page, or a site whose extensions keep no state.
function noStates(): undefined {}

/** The head tags of the page the router shows (DESIGN.md, Meta). */
export function useRouteHead(
  router: RouterLike,
  extensions: readonly RouterExtension[] = []
): Accessor<readonly unknown[] | undefined> {
  const location = useLocation();
  const site = definedSite();
  let intent: RoutePreloadFuncArgs["intent"] = "initial";

  // The preload runs again here, beside the outlet's call. Its query()
  // calls return the same promises, so nothing is fetched twice.
  const page = createMemo(() => {
    const url = location.pathname + location.search;

    return untrack(() => {
      const leaf = matchChain(router.routes, router.match(url)).at(-1);
      const args = { params: leaf?.params ?? {}, location, intent };
      intent = "navigate";

      if (!leaf?.meta) {
        return;
      }

      const data = leaf.preload?.(args);

      return { meta: leaf.meta, entry: leaf.entry, params: args.params, data };
    });
  });

  if (isServer && !untrack(page)) {
    return noStates;
  }

  // Client only (DESIGN.md, Meta): the server keeps the rejection, because
  // a symbol cannot be serialized for hydration.
  const data = createMemo(() => {
    const settled = settle(page()?.data);

    return !isServer && settled instanceof Promise
      ? orFailed(settled)
      : settled;
  });

  function argsOf(current: { params: Params; entry: TableEntry }): MetaArgs {
    const value = data();

    // SAFETY: the extensions' `args` give the fields their declarations
    // merge into MetaArgs.
    return {
      params: current.params,
      location,
      data: value === FAILED ? undefined : value,
      ...extensionArgs(extensions, current.entry, location),
    } as MetaArgs;
  }

  const resolved = createMemo(() => {
    const current = page();

    if (!current) {
      return;
    }

    const args = argsOf(current);

    const head = resolveMeta(
      current.meta,
      args,
      site,
      !isServer,
      extensions.length > 0 ? { entry: current.entry, extensions } : undefined
    );

    // Before the shell flushes: the title waits for this memo.
    if (isServer && head?.notFound) {
      httpStatus(404);
    }

    if (isServer && head?.announce) {
      announce(head.announce);
    }

    return head;
  });

  function serverMeta(): HeadMeta {
    const meta = resolved();

    if (!meta) {
      throw new Error(
        "[@visio/router] the server resolves the meta of a matched page, or throws."
      );
    }

    return meta;
  }

  if (isServer) {
    useHead([{ tag: "title", props: { children: () => serverMeta().title } }]);
    useHead(() => headTags(serverMeta()).filter((t) => t.tag !== "title"));
  } else {
    // No boundary above the head: keep the current tags while the meta is pending.
    useHead(() => {
      try {
        const resolvedMeta = latest(resolved);

        return resolvedMeta ? headTags(resolvedMeta) : [];
      } catch (error) {
        if (error instanceof NotReadyError) {
          return [];
        }

        throw error;
      }
    });
  }

  // Apart from meta(), so a meta that throws leaves the state as it is.
  return extensions.some((extension) => extension.state)
    ? createMemo(() => {
        const current = page();

        return (
          current && extensionStates(extensions, current.entry, argsOf(current))
        );
      })
    : noStates;
}
