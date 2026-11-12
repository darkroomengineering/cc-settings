import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

import {
  checkIconSvg,
  encodeIco,
  faviconSvg,
  fillsCorners,
  rasterizeSvg,
  resizePng,
} from "@visio/image-optimizer/internal/icons";
import type { Connect, Plugin, ResolvedConfig, ViteDevServer } from "vite";

export const ICONS_DIR = "src/icons";

const ARTWORK = [
  "icon.svg",
  "icon-dark.svg",
  "icon-ico.svg",
  "icon-touch.svg",
  "icon-touch.png",
] as const;

/** The artwork a site supplies: absolute paths. */
export interface IconArtwork {
  /** The tab icon, and every other size when nothing else is given. */
  light: string;
  /** The tab icon on a dark browser theme. */
  dark?: string | undefined;
  /** The favicon.ico sizes, for what does not read the SVG, with any background drawn in. */
  ico?: string | undefined;
  /** The touch and manifest icons, with their background and padding drawn in. */
  touch?: string | undefined;
}

export const ICON_FILES = {
  ico: "favicon.ico",
  svg: "icon.svg",
  touch: "apple-touch-icon.png",
  small: "icon-192.png",
  large: "icon-512.png",
  manifest: "manifest.webmanifest",
} as const;

const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;
const SMALL_SIZE = 192;
const LARGE_SIZE = 512;

/**
 * The placeholder icons of the visio site until 2026-10-11, which a site
 * copied from it ships until someone notices. sha256 of each file.
 */
export const PLACEHOLDERS = new Map([
  [
    "0e726a381fd5c7ee7e57960f9ea5ff6a354071055dd071bf130052ad5a899e3d",
    "favicon.ico",
  ],
  [
    "27df8e8985d03644b055bbd6bd19dd4ba765ebdca7f4e3898fa4b38d963f51ca",
    "apple-touch-icon.png",
  ],
]);

// Editors and design tools write these next to the artwork while it is open.
const SCRATCH = /^\.|~$|\.(?:swp|swx|swo|tmp)$|^#.*#$/u;

function scratch(file: string) {
  return SCRATCH.test(path.basename(file));
}

export function baseDir(base: string) {
  return base.endsWith("/") ? base : `${base}/`;
}

export interface IconLink {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
}

export function findArtwork(root: string): IconArtwork | undefined {
  const dir = path.join(root, ICONS_DIR);

  if (!existsSync(dir)) {
    return undefined;
  }

  const files = readdirSync(dir).filter((f) => !scratch(f));

  if (files.length === 0) {
    return undefined;
  }

  for (const file of files) {
    if (!ARTWORK.some((name) => name === file)) {
      throw new Error(
        `[visio] [ICON_NAME_UNKNOWN] ${ICONS_DIR}/${file} is not an icon file the build reads. Name it ${ARTWORK.join(", ")}, or move it out of ${ICONS_DIR}/.`
      );
    }
  }

  if (!files.includes("icon.svg")) {
    throw new Error(
      `[visio] [ICON_SVG_MISSING] ${ICONS_DIR}/ has ${files.join(", ")} but no icon.svg, the tab icon that every other file adds to. Add ${ICONS_DIR}/icon.svg.`
    );
  }

  if (files.includes("icon-touch.svg") && files.includes("icon-touch.png")) {
    throw new Error(
      `[visio] [ICON_TOUCH_TWICE] ${ICONS_DIR}/ has icon-touch.svg and icon-touch.png. Keep one of them.`
    );
  }

  function at(file: string) {
    return files.includes(file) ? path.join(dir, file) : undefined;
  }

  return {
    light: path.join(dir, "icon.svg"),
    dark: at("icon-dark.svg"),
    ico: at("icon-ico.svg"),
    touch: at("icon-touch.svg") ?? at("icon-touch.png"),
  };
}

export function iconLinks(base: string): IconLink[] {
  const root = baseDir(base);

  return [
    // `sizes` keeps Chromium from taking the ICO over the SVG.
    { rel: "icon", href: root + ICON_FILES.ico, sizes: "32x32" },
    { rel: "icon", href: root + ICON_FILES.svg, type: "image/svg+xml" },
    { rel: "apple-touch-icon", href: root + ICON_FILES.touch },
    { rel: "manifest", href: root + ICON_FILES.manifest },
  ];
}

export async function artworkNotice(
  artwork: IconArtwork
): Promise<string | undefined> {
  if (artwork.touch) {
    return undefined;
  }

  try {
    if (
      await fillsCorners(
        read(artwork.light).toString("utf-8"),
        label(artwork.light)
      )
    ) {
      return undefined;
    }
  } catch {
    // iconFiles() reports a bad icon.svg as ICON_INVALID, when its file is asked for.
    return undefined;
  }

  return `[visio] ${ICONS_DIR}/ has no icon-touch.svg or icon-touch.png, and icon.svg does not fill its corners, so the touch and app icons, 180 to 512 px, show its transparent corners. Add one with its background and padding drawn in.`;
}

function read(file: string) {
  return readFileSync(file);
}

function label(file: string) {
  return `${ICONS_DIR}/${path.basename(file)}`;
}

export async function iconFiles(
  artwork: IconArtwork,
  site: { name?: string | undefined; base: string }
): Promise<Map<string, Uint8Array | string>> {
  const light = read(artwork.light).toString("utf-8");

  try {
    await checkIconSvg(light, label(artwork.light));
    const icoFile = artwork.ico ?? artwork.light;
    const icoSvg = read(icoFile).toString("utf-8");

    const ico = await Promise.all(
      ICO_SIZES.map(async (size) => ({
        size,
        png: await rasterizeSvg(icoSvg, size, label(icoFile)),
      }))
    );

    const touchFile = artwork.touch ?? artwork.light;

    const [apple, small, large] = await Promise.all([
      touchIcon(touchFile, TOUCH_SIZE),
      touchIcon(touchFile, SMALL_SIZE),
      touchIcon(touchFile, LARGE_SIZE),
    ]);

    const dark = artwork.dark && read(artwork.dark).toString("utf-8");

    if (artwork.dark && dark !== undefined) {
      await checkIconSvg(dark, label(artwork.dark));
    }

    const svg = faviconSvg(light, dark);
    const root = baseDir(site.base);

    const unnamed = {
      start_url: root,
      icons: [
        {
          src: root + ICON_FILES.small,
          sizes: `${SMALL_SIZE}x${SMALL_SIZE}`,
          type: "image/png",
        },
        {
          src: root + ICON_FILES.large,
          sizes: `${LARGE_SIZE}x${LARGE_SIZE}`,
          type: "image/png",
        },
      ],
    };

    const manifest = site.name ? { name: site.name, ...unnamed } : unnamed;

    return new Map<string, Uint8Array | string>([
      [ICON_FILES.ico, encodeIco(ico)],
      [ICON_FILES.svg, svg],
      [ICON_FILES.touch, apple],
      [ICON_FILES.small, small],
      [ICON_FILES.large, large],
      [ICON_FILES.manifest, `${JSON.stringify(manifest, null, 2)}\n`],
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[visio] [ICON_INVALID] ${message}`, { cause: error });
  }
}

function touchIcon(file: string, size: number) {
  const fileLabel = label(file);

  return file.endsWith(".png")
    ? resizePng(read(file), size, LARGE_SIZE, fileLabel)
    : rasterizeSvg(read(file).toString("utf-8"), size, fileLabel);
}

const ICON_REL =
  /^(?:shortcut icon|icon|apple-touch-icon(?:-precomposed)?|manifest|mask-icon)$/iu;

export function handWrittenIconLinks(source: string): string[] {
  const found: string[] = [];

  for (const [tag] of source.matchAll(/<link\b[^>]*>/gu)) {
    const rel = /\brel\s*=\s*\{?\s*["'`](?<rel>[^"'`]*)["'`]/u
      .exec(tag)
      ?.groups?.rel?.trim();

    if (rel && ICON_REL.test(rel)) {
      found.push(rel);
    }
  }

  return found;
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export interface IconFindings {
  errors: string[];
  warnings: string[];
}

export function checkIcons(options: {
  root: string;
  publicDir: string;
  artwork: IconArtwork | undefined;
  build: boolean;
}): IconFindings {
  const { root, publicDir, artwork, build } = options;
  const findings: IconFindings = { errors: [], warnings: [] };

  function inPublic(file: string) {
    return publicDir !== "" && existsSync(path.join(publicDir, file));
  }

  const shell = ["src/document.tsx", "src/document.jsx"].find((f) =>
    existsSync(path.join(root, f))
  );

  const links = shell
    ? handWrittenIconLinks(readFileSync(path.join(root, shell), "utf-8"))
    : [];

  const publicLabel = path.relative(root, publicDir) || "public";

  if (artwork) {
    for (const file of Object.values(ICON_FILES)) {
      if (inPublic(file)) {
        findings.errors.push(
          `[visio] [ICON_IN_PUBLIC] ${publicLabel}/${file}: the build writes it from ${ICONS_DIR}/. Delete ${publicLabel}/${file}.`
        );
      }
    }

    if (links.length > 0) {
      findings.errors.push(
        `[visio] [ICON_LINK_HANDWRITTEN] ${shell} links ${links.join(", ")} by hand, and the router links the icons from ${ICONS_DIR}/ in every page's head. Delete the <link> tags from ${shell}.`
      );
    }

    return findings;
  }

  const add = `Add ${ICONS_DIR}/icon.svg, and the build writes every icon and links them.`;

  for (const file of ["favicon.ico", "apple-touch-icon.png"]) {
    if (
      inPublic(file) &&
      PLACEHOLDERS.get(sha256(path.join(publicDir, file))) === file
    ) {
      (build ? findings.errors : findings.warnings).push(
        `[visio] [FAVICON_PLACEHOLDER] ${publicLabel}/${file} is the placeholder of the visio starter, not this site's icon. Delete it. ${add}`
      );
    }
  }

  if (!build) {
    return findings;
  }

  if (
    !inPublic("favicon.ico") &&
    !links.some((rel) => /icon$/iu.test(rel) && !/apple/iu.test(rel))
  ) {
    findings.warnings.push(
      `[visio] [FAVICON_MISSING] The site has no favicon. ${add}`
    );
  }

  if (
    !inPublic("apple-touch-icon.png") &&
    !links.some((rel) => /apple-touch-icon/iu.test(rel))
  ) {
    findings.warnings.push(
      `[visio] [TOUCH_ICON_MISSING] The site has no apple-touch-icon, so iOS shows a screenshot on the home screen. ${add}`
    );
  }

  if (!links.some((rel) => /^manifest$/iu.test(rel))) {
    findings.warnings.push(
      `[visio] [MANIFEST_MISSING] The site has no web manifest, so Android has no icon to install. ${add}`
    );
  }

  return findings;
}

const told = new Set<string>();

function tell(config: ResolvedConfig, message: string) {
  // The build resolves the config three times, each with a new visio().
  if (told.has(message)) {
    return;
  }

  told.add(message);
  config.logger.warn(message);
}

export function icons(site: { name?: string | undefined }): Plugin {
  let artwork: IconArtwork | undefined;
  let base = "/";
  let root = process.cwd();
  let files: Promise<Map<string, Uint8Array | string>> | undefined;

  function generate(from: IconArtwork) {
    files ??= iconFiles(from, { name: site.name, base });

    return files;
  }

  return {
    name: "visio:icons",
    // The define has to be set before Vite resolves `base`, so the links, the
    // files and the dev server all take the base from here.
    config(user) {
      root = path.resolve(user.root ?? process.cwd());
      base = baseDir(user.base ?? "/");
      artwork = findArtwork(root);

      return {
        define: {
          "import.meta.env.VISIO_ICONS": JSON.stringify(
            artwork ? iconLinks(base) : null
          ),
        },
      };
    },
    async configResolved(resolved) {
      const build = resolved.command === "build";

      const { errors, warnings } = checkIcons({
        root: resolved.root,
        publicDir: resolved.publicDir,
        artwork,
        build,
      });

      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }

      for (const message of warnings) {
        tell(resolved, message);
      }

      const notice = artwork && (await artworkNotice(artwork));

      if (notice) {
        tell(resolved, notice);
      }
    },
    configureServer(server: ViteDevServer) {
      const dir = path.join(root, ICONS_DIR);

      function changed(file: string) {
        return path.dirname(file) === dir && !scratch(file);
      }

      server.watcher.add(dir);
      server.watcher.on("change", (file) => {
        if (changed(file)) {
          files = undefined;
        }
      });

      // A file added or removed changes the head links, which are a define.
      for (const event of ["add", "unlink"] as const) {
        server.watcher.on(event, async (file) => {
          if (changed(file)) {
            await server.restart();
          }
        });
      }

      if (!artwork) {
        return;
      }

      const own = artwork;

      async function serve(
        name: string,
        res: ServerResponse,
        next: Connect.NextFunction
      ) {
        let set: Map<string, Uint8Array | string>;

        try {
          set = await generate(own);
        } catch (error) {
          files = undefined;
          next(error);

          return;
        }

        res.setHeader("content-type", contentType(name));
        res.setHeader("cache-control", "no-cache");
        res.end(set.get(name));
      }

      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";

        if (!pathname.startsWith(base)) {
          return next();
        }

        const name = pathname.slice(base.length);

        if (!Object.values(ICON_FILES).some((file) => file === name)) {
          return next();
        }

        serve(name, res, next);
      });
    },
    async generateBundle() {
      if (!artwork || this.environment.name !== "client") {
        return;
      }

      for (const [fileName, source] of await generate(artwork)) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

function contentType(name: string): string {
  if (name.endsWith(".ico")) {
    return "image/x-icon";
  }

  if (name.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (name.endsWith(".png")) {
    return "image/png";
  }

  return "application/manifest+json";
}
