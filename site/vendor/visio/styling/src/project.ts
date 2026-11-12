import { existsSync, readFileSync } from "node:fs";
import { glob, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { SourceMapSegment } from "@jridgewell/sourcemap-codec";
import browserslist from "browserslist";
import { browserslistToTargets, transform as lightning } from "lightningcss";
import { MagicString } from "magic-string";
import { parseSync } from "oxc-parser";

import {
  child,
  childNodes,
  children,
  isProgram,
  optChild,
  text,
} from "./compiler/ast.ts";
import type { AstNode } from "./compiler/ast.ts";
import { AtomRegistry } from "./compiler/atomize.ts";
import { emit } from "./compiler/emit.ts";
import type {
  GlobalRule,
  Keyframes,
  PropertyRegistration,
} from "./compiler/emit.ts";
import { warning } from "./compiler/errors.ts";
import type { Diagnostic } from "./compiler/errors.ts";
import { isTokens } from "./compiler/evaluate.ts";
import { extract } from "./compiler/extract.ts";
import type {
  ClassLiteral,
  Composition,
  ExtractResult,
} from "./compiler/extract.ts";
import {
  applyIgnores,
  collectDirectives,
  lineColumn,
  lineOf,
  lineStartsOf,
  objectKeySpans,
} from "./compiler/ignore.ts";
import type { IgnoreDirective } from "./compiler/ignore.ts";
import type { AtomOrigin, Declaration, SourceSpan } from "./compiler/model.ts";
import {
  FALLBACK_METRICS,
  fontMetrics,
  matchFallback,
  optimizeFont,
} from "./fonts/index.ts";
import type { OptimizedFont, Subset, WeightFallback } from "./fonts/index.ts";
import { isString } from "./guards.ts";
import { tokenVarName } from "./helpers.ts";
import {
  buildReport,
  isFindingCode,
  usedVarsFromDeclarations,
} from "./lint/report.ts";
import type { Finding, FindingCode, Located, Report } from "./lint/report.ts";
import { packageCss } from "./package-css.ts";
import { reset as resetCss } from "./reset.ts";
import { tokensToCss } from "./tokens/css.ts";
import { A11Y, buildConditions, faces } from "./tokens/index.ts";
import type { Tokens } from "./tokens/index.ts";
import type { FontSource, FontToken } from "./tokens/types.ts";

/** A module the compiler reads, with or without a query. */
export const SOURCE_FILE = /\.[cm]?[jt]sx?(?:\?|$)/u;

/** The oldest browsers that know cascade layers, which the sheet is built on. */
const TARGETS = browserslistToTargets(
  browserslist(["defaults and fully supports css-cascade-layers"])
);

/** The tokens module of every site, relative to its root. */
export const TOKENS_PATH = "src/styles/tokens.ts";

/** The files a project compiles, relative to its root. */
const INCLUDE = "src/**/*.{ts,tsx}";

export interface ProjectOptions {
  root: string;
  /** Tests only. Default `TOKENS_PATH`. */
  tokens?: string;
  /** Where subsetted fonts are cached; the plugin passes Vite's cache directory. */
  cacheDir?: string;
  /** Tests only. Default `'strict'`. */
  typography?: "open" | "strict";
  /** Tests only. Default true. */
  prune?: boolean;
}

function cut(s: FontSource) {
  return `${s.weight ?? 400} ${s.style ?? "normal"}`;
}

function isCustomSubset(
  x: Subset | "used" | undefined
): x is Exclude<Subset, string> {
  return typeof x === "object";
}

/**
 * `latin-ext` has no ASCII. A face that lists it needs a face of the same
 * weight and style that draws ASCII, or English text falls to the fallback.
 */
function checkLatin(key: string, sources: readonly FontSource[]) {
  const ascii = new Set(
    sources
      .values()
      .filter((s) =>
        faces(s).some(
          (x) =>
            x === undefined ||
            x === "latin" ||
            isCustomSubset(x) ||
            x === "used"
        )
      )
      .map(cut)
  );

  for (const [index, s] of sources.entries()) {
    if (faces(s).includes("latin-ext") && !ascii.has(cut(s))) {
      throw new Error(
        `[@visio/styling] fonts.${key}.sources[${index}]: 'latin-ext' has no ASCII, the same as Google's subset. Write subset: ['latin', 'latin-ext'].`
      );
    }
  }
}

/** A subsetted font file and the token source it came from. */
export interface FontFile extends OptimizedFont {
  /** Key in `tokens.fonts`. */
  key: string;
  /** Index in that font's `sources`. */
  index: number;
  /** Index in that font's files, the order of `t.fonts.x.urls`. */
  face: number;
  /** The authored `src`, relative to the project root. */
  src: string;
}

/** Font key -> URL per file. Values starting with `import.meta.` are code, not strings. */
export type FontUrls = Record<string, string[]>;

export interface FileState {
  declarations: Declaration[];
  globals: GlobalRule[];
  keyframes: Keyframes[];
  properties: PropertyRegistration[];
  diagnostics: Diagnostic[];
  tokenRefs: string[];
  classLiterals: ClassLiteral[];
  compositions: Composition[];
  /** Distinct characters in the file's text, for `subset: 'used'`. */
  chars: string;
  /** Byte offset of the start of each line, for source maps. */
  lineStarts: number[];
  /** `visio-ignore` directives in the file. */
  ignores: IgnoreDirective[];
}

export interface Stylesheet {
  css: string;
  /** Source map JSON, mapping every rule to the property that produced it. */
  map: string;
  pruned: string[];
}

export const ARTIFACTS_DIR = ".visio";

type SourceMap = ReturnType<MagicString["generateMap"]>;

/**
 * The `defineTokens(...)` call in a tokens module, whatever the import calls
 * it. The module is already known by path, so the import's source is not
 * checked; a linked checkout or a test may import it from anywhere.
 */
function defineTokensCall(program: AstNode): AstNode | null {
  let local: string | null = null;

  for (const stmt of children(program, "body")) {
    if (stmt.type !== "ImportDeclaration") {
      continue;
    }

    for (const spec of children(stmt, "specifiers")) {
      const imported = optChild(spec, "imported");

      if (imported && (imported.name ?? imported.value) === "defineTokens") {
        local = text(child(spec, "local"), "name");
      }
    }
  }

  return local ? findCall(program, local) : null;
}

function findCall(node: AstNode, callee: string): AstNode | null {
  if (node.type === "CallExpression") {
    const c = child(node, "callee");

    if (c.type === "Identifier" && c.name === callee) {
      return node;
    }
  }

  for (const c of childNodes(node)) {
    const found = findCall(c.node, callee);

    if (found) {
      return found;
    }
  }

  return null;
}

const TOKEN_GROUPS = ["colors", "sizes", "easings", "fonts"] as const;

function isTokenGroup(
  group: string | undefined
): group is (typeof TOKEN_GROUPS)[number] {
  return TOKEN_GROUPS.some((g) => g === group);
}

function findingCodeOf(d: Diagnostic): FindingCode {
  if (!isFindingCode(d.code)) {
    throw new Error(
      `[@visio/styling] The warning ${d.code} is not a report finding. Add it to FINDING_CODES.`
    );
  }

  return d.code;
}

function withoutQuery(id: string): string {
  const at = id.indexOf("?");

  return at === -1 ? id : id.slice(0, at);
}

/** Whether `file` is inside `dir`, not in a sibling whose name starts the same. */
function isInside(dir: string, file: string): boolean {
  if (!file.startsWith(dir)) {
    return false;
  }

  const next = file[dir.length];

  return next === "/" || next === "\\" || dir.endsWith("/");
}

/** What a file puts in the sheet besides atoms, as one comparable string. */
function sheetInputs(state: FileState | undefined): string {
  if (!state) {
    return "";
  }

  const globals = state.globals.map((g) => [
    g.selector,
    g.template,
    g.conds,
    g.declarations,
  ]);

  return JSON.stringify([
    globals,
    state.keyframes,
    state.properties,
    state.tokenRefs.toSorted(),
  ]);
}

function subsetSource(
  root: string,
  where: string,
  s: FontSource,
  subsets: readonly (Subset | "used" | undefined)[]
): string | null {
  if (!s.subset) {
    if (s.axes) {
      throw new Error(
        `[@visio/styling] ${where}: \`axes\` pins an instance while subsetting, so it needs \`subset\` too.`
      );
    }

    return null;
  }

  if (subsets.length === 0) {
    throw new Error(
      `[@visio/styling] ${where}: the \`subset\` list is empty. Name at least one subset, or drop \`subset\` to use the file as is.`
    );
  }

  if (subsets.length > 1 && subsets.includes("used")) {
    throw new Error(
      `[@visio/styling] ${where}: \`'used'\` cannot go in a list: it is every character the site writes, so it is the only subset. Write \`subset: 'used'\`, or a list of presets.`
    );
  }

  const ext = path.extname(s.src).toLowerCase();

  if (ext !== ".otf" && ext !== ".ttf") {
    throw new Error(
      `[@visio/styling] ${where}: subsetting needs an OTF or TTF file, got "${s.src}". Drop \`subset\` to use the file as is.`
    );
  }

  const abs = path.resolve(root, s.src);

  if (!existsSync(abs)) {
    throw new Error(
      `[@visio/styling] ${where}: "${s.src}" not found. Font paths are relative to the project root.`
    );
  }

  return abs;
}

async function subsetFile(
  options: Parameters<typeof optimizeFont>[0],
  file: Omit<FontFile, keyof OptimizedFont>
): Promise<FontFile> {
  const optimized = await optimizeFont(options);

  return { ...optimized, ...file };
}

/** The numeric weight of a source, or undefined for a range (`'300 700'`). */
function weightOf(s: FontSource): number | undefined {
  const w = s.weight ?? 400;

  if (w === "normal") {
    return 400;
  }

  if (w === "bold") {
    return 700;
  }

  const n = Number(w);

  return Number.isFinite(n) ? n : undefined;
}

async function fallbackFor(
  key: string,
  weight: number | undefined,
  adjust: string | undefined,
  stack: string,
  abs: string,
  axes: FontSource["axes"]
): Promise<[string, WeightFallback | null]> {
  const metrics = await fontMetrics(new Uint8Array(readFileSync(abs)), axes);
  const face = matchFallback(metrics, stack, (weight ?? 400) >= 600);

  if (!face && adjust !== undefined) {
    throw new Error(
      `[@visio/styling] fonts.${key}.adjust: no metrics known for "${adjust}". Known: ${Object.values(
        FALLBACK_METRICS
      )
        .map((m) => m.familyName)
        .join(", ")}. Or set adjust: false.`
    );
  }

  return [key, face && { weight, face }];
}

interface FontQueue {
  tasks: Promise<FontFile>[];
  matches: Promise<[string, WeightFallback | null]>[];
  used: string;
  cacheDir: string;
}

export class Project {
  readonly registry = new AtomRegistry();
  readonly files = new Map<string, FileState>();
  readonly root: string;
  readonly tokensPath: string;
  readonly typography: "open" | "strict";
  tokens: Tokens | null = null;
  tokenExports: Record<string, unknown> | null = null;
  conditions: Record<string, string> = {};
  /** Subsetted font files, filled by `optimizeFonts()`. */
  fonts: FontFile[] = [];
  /** Metric-matched local fallback per font key, one per weight, filled by `optimizeFonts()`. */
  fallbacks: Record<string, WeightFallback[]> = {};
  /** Directives written in the tokens module, keyed by token path (`colors.accent`, `type.body`). */
  tokensIgnores: IgnoreDirective[] = [];
  /** Malformed directives in the tokens module. */
  tokensDiagnostics: Diagnostic[] = [];
  private readonly opts: ProjectOptions;
  private readonly packageCss: string;
  /**
   * The last compile of each file and the code it read. The scan, every
   * environment's transform, and a hot update's re-fetch all hand over the
   * same code; the registry still holds that compile's atoms, so its result
   * is still true.
   */
  private readonly compiled = new Map<
    string,
    { code: string; result: ExtractResult }
  >();
  /** Built sheets by minify flag and font urls. Any compile, token load, or font change clears it. */
  private readonly sheets = new Map<string, Stylesheet>();
  /** Set when a compile changed what the sheet holds besides atoms. */
  private inputsChanged = true;

  constructor(opts: ProjectOptions) {
    this.opts = opts;
    this.root = opts.root;
    this.tokensPath = path.resolve(opts.root, opts.tokens ?? TOKENS_PATH);
    this.typography = opts.typography ?? "strict";
    this.packageCss = packageCss(opts.root);
  }

  async loadTokens() {
    // Bun ignores a query on a file: import, so `?t=` cannot reload it; its module registry is the require cache.
    Reflect.deleteProperty(
      createRequire(import.meta.url).cache,
      this.tokensPath
    );

    const url = pathToFileURL(this.tokensPath).href;
    // SAFETY: a module namespace is an object of its exports.
    const mod = (await import(url)) as Record<string, unknown>;
    this.tokenExports = mod;
    this.tokens = Object.values(mod).findLast(isTokens) ?? null;

    if (!this.tokens) {
      throw new Error(
        `[@visio/styling] ${path.relative(this.root, this.tokensPath)} does not export a defineTokens() result.`
      );
    }

    this.conditions = buildConditions(this.tokens.source);
    this.scanTokensDirectives();
    // Every compile read the old tokens.
    this.compiled.clear();
    this.sheets.clear();
    this.inputsChanged = true;
  }

  /**
   * Whether the sheet may differ from the one served last: an atom came or
   * went, or a file's globals, keyframes, `cssVars()` registrations, or token
   * references changed. Token references decide which variables are pruned.
   */
  get sheetChanged(): boolean {
    return this.registry.changed || this.inputsChanged;
  }

  markSheetClean() {
    this.registry.markClean();
    this.inputsChanged = false;
  }

  /**
   * Reads the `visio-ignore` directives in the tokens module. A finding that
   * points at a token (`TOKEN_UNUSED`) is ignored next to the token, so the
   * key spans come from the object literal handed to `defineTokens()`.
   */
  private scanTokensDirectives() {
    this.tokensIgnores = [];
    this.tokensDiagnostics = [];
    const code = readFileSync(this.tokensPath, "utf-8");
    const parsed = parseSync(this.tokensPath, code);

    if (parsed.errors.length) {
      return;
    }

    const { program } = parsed;

    if (!isProgram(program)) {
      throw new Error("[@visio/styling] oxc-parser returned no program node.");
    }

    const spans = new Map<string, SourceSpan>();
    const call = defineTokensCall(program);
    const [arg] = call ? children(call, "arguments") : [];

    if (arg) {
      objectKeySpans(arg, "", spans);
    }

    const { directives, diagnostics } = collectDirectives(
      path.relative(this.root, this.tokensPath),
      code,
      parsed.comments,
      spans
    );

    this.tokensIgnores = directives;
    this.tokensDiagnostics = diagnostics;
  }

  /**
   * Subsets every font source that asks for it. Cached by content, so this
   * is a file read after the first run. Errors name the token that is wrong.
   */
  async optimizeFonts(): Promise<FontFile[]> {
    const source = this.tokens?.source;

    if (!source) {
      throw new Error("[@visio/styling] tokens not loaded");
    }

    this.checkFonts();
    const { cacheDir } = this.opts;

    if (!cacheDir) {
      throw new Error("[@visio/styling] optimizeFonts() needs `cacheDir`.");
    }

    const tasks: Promise<FontFile>[] = [];
    const matches: Promise<[string, WeightFallback | null]>[] = [];

    const queue: FontQueue = {
      tasks,
      matches,
      used: this.usedChars(),
      cacheDir,
    };

    for (const [key, font] of Object.entries(source.fonts ?? {})) {
      this.queueFont(key, font, queue);
    }

    this.fonts = await Promise.all(tasks);
    this.fallbacks = {};

    for (const [key, face] of await Promise.all(matches)) {
      if (face) {
        (this.fallbacks[key] ??= []).push(face);
      }
    }

    this.sheets.clear();

    return this.fonts;
  }

  /** The font token errors the build stops on, without subsetting anything. */
  checkFonts() {
    for (const [key, font] of Object.entries(this.tokens?.source.fonts ?? {})) {
      const sources = font.sources ?? [];
      checkLatin(key, sources);
      let local = false;

      for (const [index, s] of sources.entries()) {
        const where = `fonts.${key}.sources[${index}]`;
        const subsets = faces(s);

        if (subsetSource(this.root, where, s, subsets) === null) {
          continue;
        }

        local = true;

        if (subsets.includes(undefined)) {
          throw new Error(
            `[@visio/styling] ${where}: a subsetted source lists no subset.`
          );
        }
      }

      if (isString(font.adjust) && !local) {
        throw new Error(
          `[@visio/styling] fonts.${key}.adjust: matching needs a local source with \`subset\` to measure.`
        );
      }
    }
  }

  private queueFont(key: string, font: FontToken, queue: FontQueue) {
    const sources = font.sources ?? [];

    // Italics only when there is no upright file: a face measured from an
    // italic would be declared upright, while the browser slants an upright one.
    const local = sources.filter((x) => x.subset);
    const upright = local.filter((x) => x.style !== "italic");
    const measured = new Map<number | undefined, FontSource>();

    for (const x of upright.length ? upright : local) {
      if (!measured.has(weightOf(x))) {
        measured.set(weightOf(x), x);
      }
    }

    let count = 0;

    for (const [index, s] of sources.entries()) {
      const where = `fonts.${key}.sources[${index}]`;
      const subsets = faces(s);
      const first = count;
      count += subsets.length;
      const abs = subsetSource(this.root, where, s, subsets);

      if (abs === null) {
        continue;
      }

      for (const [part, value] of subsets.entries()) {
        // checkFonts() stopped on a source that lists no subset.
        if (value === undefined) {
          continue;
        }

        const subset: Subset = value === "used" ? { chars: queue.used } : value;
        const file = { key, index, face: first + part, src: s.src };
        queue.tasks.push(
          subsetFile(
            { src: abs, subset, cacheDir: queue.cacheDir, axes: s.axes },
            file
          )
        );
      }

      const weight = weightOf(s);
      const stack = isString(font.adjust) ? font.adjust : font.fallback;

      if (measured.get(weight) === s && font.adjust !== false && stack) {
        queue.matches.push(
          fallbackFor(key, weight, font.adjust, stack, abs, s.axes)
        );
      }
    }
  }

  /** True when a token font source asks for `subset: 'used'`. */
  subsetsUsedChars(): boolean {
    return Object.values(this.tokens?.source.fonts ?? {}).some((f) =>
      (f.sources ?? []).some((s) => s.subset === "used")
    );
  }

  /**
   * Characters for `subset: 'used'`: printable ASCII, so plain numbers and
   * code still render, plus every other character written in the compiled
   * files. Where a style transforms case, the other case is included too.
   * Text built at runtime from locale formatting or a CMS is not covered.
   */
  usedChars(): string {
    const chars = new Set<string>();

    for (let cp = 0x20; cp <= 0x7e; cp += 1) {
      chars.add(String.fromCodePoint(cp));
    }

    const transforms = new Set<string>();

    for (const f of this.files.values()) {
      for (const ch of f.chars) {
        if (ch >= " ") {
          chars.add(ch);
        }
      }

      for (const d of [
        ...f.declarations,
        ...f.globals.flatMap((g) => g.declarations),
      ]) {
        if (d.prop === "text-transform") {
          transforms.add(d.value);
        }
      }
    }

    const written = [...chars].join("");

    if (transforms.has("uppercase") || transforms.has("capitalize")) {
      for (const ch of written.toUpperCase()) {
        chars.add(ch);
      }
    }

    if (transforms.has("lowercase")) {
      for (const ch of written.toLowerCase()) {
        chars.add(ch);
      }
    }

    return [...chars].join("");
  }

  /** `unicode-range` per font file, where the file decides it (`subset: 'used'`). */
  fontRanges(): Record<string, (string | undefined)[]> {
    const source = this.tokens?.source;

    return Object.fromEntries(
      Object.entries(source?.fonts ?? {}).map(([key, font]) => [
        key,
        (font.sources ?? [])
          .flatMap(faces)
          .map(
            (_, face) =>
              this.fonts.find((f) => f.key === key && f.face === face)
                ?.unicodeRange
          ),
      ])
    );
  }

  /** Every font file's URL: `resolve` for subsetted files, the authored `src` otherwise. */
  fontUrls(resolve: (file: FontFile) => string): FontUrls {
    const source = this.tokens?.source;

    return Object.fromEntries(
      Object.entries(source?.fonts ?? {}).map(([key, font]) => [
        key,
        (font.sources ?? [])
          .flatMap((s) => faces(s).map(() => s.src))
          .map((src, face) => {
            const file = this.fonts.find(
              (f) => f.key === key && f.face === face
            );

            return file ? resolve(file) : src;
          }),
      ])
    );
  }

  /**
   * Rewrites the tokens module so `defineTokens()` receives the shipped font
   * URLs. That is how `t.fonts.x.url` is a plain string at runtime with no
   * virtual module behind it. Returns null when there is nothing to inject.
   */
  injectFontUrls(
    code: string,
    urls: FontUrls
  ): { code: string; map: SourceMap } | null {
    if (Object.keys(urls).length === 0) {
      return null;
    }

    const parsed = parseSync(this.tokensPath, code);

    if (parsed.errors.length) {
      return null;
    }

    const { program } = parsed;

    if (!isProgram(program)) {
      throw new Error("[@visio/styling] oxc-parser returned no program node.");
    }

    const call = defineTokensCall(program);

    if (!call) {
      return null;
    }

    const [arg, ...more] = children(call, "arguments");

    if (!arg || more.length > 0) {
      return null;
    }

    const entries = Object.entries(urls).map(([key, list]) => {
      const values = list.map((u) =>
        u.startsWith("import.meta.") ? u : JSON.stringify(u)
      );

      return `${JSON.stringify(key)}: [${values.join(", ")}]`;
    });

    const s = new MagicString(code);
    s.appendRight(arg.end, `, { fontUrls: { ${entries.join(", ")} } }`);

    return {
      code: s.toString(),
      map: s.generateMap({
        hires: true,
        source: this.tokensPath,
        includeContent: false,
      }),
    };
  }

  isTokensImport(source: string, importer: string): boolean {
    if (!source.startsWith(".") && !source.startsWith("/")) {
      return false;
    }

    const base = path.resolve(path.dirname(importer), source);

    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, "index.ts"),
    ];

    return candidates.includes(this.tokensPath);
  }

  shouldCompile(id: string): boolean {
    if (
      id.includes("/node_modules/") ||
      id.startsWith("\0") ||
      id.includes("virtual:")
    ) {
      return false;
    }

    const clean = withoutQuery(id);

    return SOURCE_FILE.test(clean) && isInside(this.root, clean);
  }

  /**
   * Compiles one file and records its contribution. Code the file was last
   * compiled from returns that result again without compiling.
   */
  compile(id: string, code: string): ExtractResult {
    const clean = withoutQuery(id);
    const last = this.compiled.get(clean);

    if (last?.code === code) {
      return last.result;
    }

    const result = extract({
      file: path.relative(this.root, clean),
      sourcePath: clean,
      code,
      tokenExports: this.tokenExports,
      isTokensImport: (source) => this.isTokensImport(source, clean),
      typography: this.typography,
      fontFloor: A11Y.minFontSize,
      conditions: this.conditions,
      registry: this.registry,
    });

    // The tokens module's directives are read against its token paths in
    // scanTokensDirectives(); the line-only ones the extractor sees would
    // count twice.
    const isTokensModule = clean === this.tokensPath;
    const ignores = isTokensModule ? [] : result.ignores;

    const diagnostics = isTokensModule
      ? result.diagnostics.filter((d) => !d.code.startsWith("IGNORE_"))
      : result.diagnostics;

    const relevant =
      result.changed ||
      result.tokenRefs.length > 0 ||
      diagnostics.length > 0 ||
      result.globals.length > 0 ||
      result.classLiterals.length > 0 ||
      ignores.length > 0 ||
      [...result.chars].some((ch) => ch > "~");

    const before = sheetInputs(this.files.get(clean));

    if (relevant) {
      this.files.set(clean, {
        declarations: result.declarations,
        globals: result.globals,
        keyframes: result.keyframes,
        properties: result.properties,
        diagnostics,
        tokenRefs: result.tokenRefs,
        classLiterals: result.classLiterals,
        compositions: result.compositions,
        chars: result.chars,
        lineStarts: lineStartsOf(code),
        ignores,
      });
    } else {
      this.files.delete(clean);
    }

    if (sheetInputs(this.files.get(clean)) !== before) {
      this.inputsChanged = true;
    }

    const out = { ...result, diagnostics, ignores };
    this.compiled.set(clean, { code, result: out });
    this.sheets.clear();

    return out;
  }

  forget(id: string) {
    const clean = withoutQuery(id);
    this.compiled.delete(clean);

    if (!this.files.delete(clean)) {
      return;
    }

    this.registry.release(path.relative(this.root, clean));
    this.inputsChanged = true;
    this.sheets.clear();
  }

  /** Compiles every file under `src/`. Returns all diagnostics. */
  async scan(): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    for await (const file of glob(path.join(this.root, INCLUDE))) {
      if (file.includes("/node_modules/")) {
        continue;
      }

      const code = readFileSync(file, "utf-8");
      diagnostics.push(...this.compile(file, code).diagnostics);
    }

    diagnostics.push(...this.literalDiagnostics(), ...this.tokensDiagnostics);

    return diagnostics;
  }

  /**
   * Warnings for generated atom names typed by hand in JSX. Needs the whole
   * project compiled first, since the atom may come from another file.
   */
  literalDiagnostics(): Diagnostic[] {
    const out: Diagnostic[] = [];

    for (const [file, state] of this.files) {
      const found: Diagnostic[] = [];

      for (const lit of state.classLiterals) {
        const atom = this.registry.get(lit.name);

        if (!atom) {
          continue;
        }

        found.push(
          warning(
            "ATOM_HANDWRITTEN",
            `\`${lit.name}\` is a generated class (${atom.prop}: ${atom.value}) typed by hand. It changes whenever that style changes. Put the declaration in css() and use the style key instead.`,
            {
              file: path.relative(this.root, file),
              start: lit.start,
              end: lit.end,
              line: lineOf(state.lineStarts, lit.start),
            }
          )
        );
      }

      out.push(...applyIgnores(found, state.ignores, state.lineStarts));
    }

    return out;
  }

  /** `line 12` for a warning without a style path, from its offset in the file. */
  private lineOfDiagnostic(d: Diagnostic): string {
    if (d.line !== undefined) {
      return `line ${d.line}`;
    }

    const state = d.file
      ? this.files.get(path.resolve(this.root, d.file))
      : undefined;

    if (state && d.start !== undefined) {
      return `line ${lineOf(state.lineStarts, d.start)}`;
    }

    return "file";
  }

  /** Variable names referenced anywhere: inside styles, or as token members in code. */
  usedVars(): Set<string> {
    const used = usedVarsFromDeclarations(
      [...this.files.values()].flatMap((f) => f.declarations)
    );

    const source = this.tokens?.source;

    if (!source) {
      return used;
    }

    for (const f of this.files.values()) {
      for (const ref of f.tokenRefs) {
        const [group, key] = ref.split(".");

        if (group === "" || group === "source") {
          for (const g of TOKEN_GROUPS) {
            for (const k of Object.keys(source[g] ?? {})) {
              used.add(tokenVarName(g, k));
            }
          }
        } else if (group === "type") {
          const presets = key
            ? [source.type?.[key]]
            : Object.values(source.type ?? {});

          for (const p of presets) {
            if (p) {
              used.add(tokenVarName("fonts", p.font));
            }
          }
        } else if (isTokenGroup(group)) {
          const keys = key ? [key] : Object.keys(source[group] ?? {});

          for (const k of keys) {
            used.add(tokenVarName(group, k));
          }
        }
      }
    }

    return used;
  }

  private allDeclarations(): Located[] {
    return [...this.files.entries()].flatMap(([file, f]) =>
      f.declarations.map((d) => ({
        ...d,
        file: path.relative(this.root, file),
      }))
    );
  }

  /** A v3 source map for the raw sheet: one segment per line that has an origin. */
  private sourceMap(origins: (AtomOrigin | undefined)[]): string {
    const sources: string[] = [];
    const sourceIndex = new Map<string, number>();

    const mappings: SourceMapSegment[][] = origins.map((origin) => {
      if (!origin) {
        return [];
      }

      const abs = path.resolve(this.root, origin.file);
      const state = this.files.get(abs);

      if (!state) {
        return [];
      }

      let idx = sourceIndex.get(abs);

      if (idx === undefined) {
        idx = sources.length;
        sources.push(abs);
        sourceIndex.set(abs, idx);
      }

      const [line, column] = lineColumn(state.lineStarts, origin.offset);

      return [[0, idx, line, column]];
    });

    return JSON.stringify({
      version: 3,
      file: "visio.css",
      sources: sources.map((s) => path.relative(this.root, s)),
      names: [],
      mappings: encode(mappings),
    });
  }

  /**
   * Lightning CSS composes our map but lists the sheet itself as a source and
   * keeps the paths relative. Drop the former and make the latter absolute.
   */
  private cleanMap(raw: string): string {
    // SAFETY: Lightning CSS writes a v3 source map, which has `sources` and
    // `mappings`.
    const map = JSON.parse(raw) as { sources: string[]; mappings: string };
    const sources: string[] = [];
    const renumber = new Map<number, number>();

    for (const [i, s] of map.sources.entries()) {
      if (s === "visio.css") {
        continue;
      }

      renumber.set(i, sources.length);
      sources.push(path.resolve(this.root, s));
    }

    const mappings = decode(map.mappings).map((line) =>
      line.flatMap((seg): SourceMapSegment[] => {
        if (seg.length === 1) {
          return [];
        }

        const idx = renumber.get(seg[1]);

        if (idx === undefined) {
          return [];
        }

        return [[seg[0], idx, seg[2], seg[3]]];
      })
    );

    return JSON.stringify({
      version: 3,
      file: "visio.css",
      sources,
      names: [],
      mappings: encode(mappings),
    });
  }

  /**
   * The complete stylesheet with its source map. `fontUrls` come from the
   * bundler. Built once per minify flag and font urls until something changes.
   */
  css({
    minify = false,
    fontUrls,
  }: { minify?: boolean; fontUrls?: FontUrls } = {}): Stylesheet {
    if (!this.tokens) {
      throw new Error("[@visio/styling] tokens not loaded");
    }

    const key = JSON.stringify([minify, fontUrls ?? null]);
    const cached = this.sheets.get(key);

    if (cached) {
      return cached;
    }

    const globals: GlobalRule[] = [];
    const keyframes: Keyframes[] = [];
    const properties = new Map<string, PropertyRegistration>();

    for (const f of this.files.values()) {
      globals.push(...f.globals);
      keyframes.push(...f.keyframes);

      for (const p of f.properties) {
        properties.set(p.name, p);
      }
    }

    const tokensCss = tokensToCss(this.tokens.source, {
      used: this.opts.prune === false ? undefined : this.usedVars(),
      fontUrls,
      fontRanges: this.fontRanges(),
      fallbacks: this.fallbacks,
    });

    const raw = emit({
      conditions: this.conditions,
      tokensCss: tokensCss.css,
      resetCss: this.packageCss ? `${resetCss}\n${this.packageCss}` : resetCss,
      atoms: this.registry.all(),
      globals,
      keyframes,
      properties: [...properties.values()],
    });

    const out = lightning({
      filename: "visio.css",
      code: Buffer.from(raw.css),
      minify,
      targets: TARGETS,
      drafts: { customMedia: true },
      sourceMap: true,
      inputSourceMap: this.sourceMap(raw.origins),
    });

    const sheet: Stylesheet = {
      css: out.code.toString(),
      map: out.map ? this.cleanMap(out.map.toString()) : "",
      pruned: tokensCss.pruned,
    };

    this.sheets.set(key, sheet);

    return sheet;
  }

  /**
   * The project report. `pruned` is the list a sheet built from the current
   * state already carries; without it the tokens are pruned again here.
   */
  report(pruned?: string[]): Report {
    // Every warning is a finding, so one list decides what fails the build,
    // the dev terminal, and `visio-styling check`.
    const warnings = [
      ...[...this.files.values()].flatMap((f) => f.diagnostics),
      ...this.literalDiagnostics(),
    ].filter((d) => d.severity === "warning");

    const extra: Finding[] = warnings.map((d) => ({
      code: findingCodeOf(d),
      message: d.message,
      locations: [
        { file: d.file ?? "", path: d.path ?? this.lineOfDiagnostic(d) },
      ],
    }));

    const used = this.usedVars();

    const compositions = [...this.files.entries()].flatMap(([file, f]) =>
      f.compositions.map((c) => ({
        ...c,
        file: path.relative(this.root, file),
      }))
    );

    const ignores = [
      ...this.tokensIgnores,
      ...[...this.files.values()].flatMap((f) => f.ignores),
    ];

    return buildReport(
      this.allDeclarations(),
      this.tokens,
      this.registry.size,
      {
        used,
        pruned:
          pruned ??
          (this.tokens && this.opts.prune !== false
            ? tokensToCss(this.tokens.source, { used }).pruned
            : []),
        extra,
        tokensFile: path.relative(this.root, this.tokensPath),
        compositions,
        ignores,
      }
    );
  }

  /** Writes `.visio/app.css` and its map, then `.visio/report.json`. */
  async writeArtifacts(
    sheet: Stylesheet | undefined,
    report: Report
  ): Promise<void> {
    const dir = path.join(this.root, ARTIFACTS_DIR);
    await mkdir(dir, { recursive: true });

    if (sheet) {
      await Promise.all([
        writeFile(
          path.join(dir, "app.css"),
          `${sheet.css}\n/*# sourceMappingURL=app.css.map */\n`
        ),
        writeFile(path.join(dir, "app.css.map"), sheet.map),
      ]);
    }

    await writeFile(
      path.join(dir, "report.json"),
      JSON.stringify(report, null, 2)
    );
  }
}
