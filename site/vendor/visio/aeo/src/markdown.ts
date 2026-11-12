import { find, findAll, parse, textOf } from "./html.ts";
import type { Element, Node } from "./html.ts";

export interface PageHead {
  title?: string | undefined;
  description?: string | undefined;
  canonical?: string | undefined;
  modified?: string | undefined;
  noindex: boolean;
}

const SKIP = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "nav",
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
]);

const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);

function concealed(e: Element): boolean {
  return (
    // `until-found` content is in the page: find-in-page and anchors open it.
    ("hidden" in e.attrs && e.attrs.hidden !== "until-found") ||
    e.attrs["aria-hidden"] === "true" ||
    e.attrs["data-agent"] === "skip"
  );
}

function hidden(e: Element): boolean {
  return SKIP.has(e.name) || concealed(e);
}

export function readHead(root: Element): PageHead {
  const head = find(root, (e) => e.name === "head") ?? root;

  function meta(key: string, value: string) {
    return (
      find(head, (e) => e.name === "meta" && e.attrs[key] === value)?.attrs
        .content || undefined
    );
  }

  const title = find(head, (e) => e.name === "title");

  return {
    title: title ? textOf(title).trim() || undefined : undefined,
    description: meta("name", "description"),
    canonical:
      find(head, (e) => e.name === "link" && e.attrs.rel === "canonical")?.attrs
        .href || undefined,
    modified: meta("property", "article:modified_time"),
    noindex: /\bnoindex\b/u.test(meta("name", "robots") ?? ""),
  };
}

interface Context {
  base: string | undefined;
  streamed: Map<string, Element>;
}

function* flow(nodes: readonly Node[], ctx: Context): Generator<Node> {
  // The fallback a streamed template replaces runs up to a comment with the template's id.
  let fallbackEnd: string | undefined;

  for (const node of nodes) {
    if (fallbackEnd !== undefined) {
      if (node.type === "comment" && node.value === fallbackEnd) {
        fallbackEnd = undefined;
      }

      continue;
    }

    const key =
      node.type === "element" && node.name === "template"
        ? node.attrs.id
        : undefined;

    if (!key?.startsWith("pl-")) {
      yield node;
      continue;
    }

    const content = ctx.streamed.get(key.slice(3));

    if (!content) {
      continue;
    }

    fallbackEnd = key;
    yield* flow(content.children, ctx);
  }
}

function href(url: string, ctx: Context): string {
  try {
    return ctx.base ? new URL(url, ctx.base).href : url;
  } catch {
    return url;
  }
}

// An underscore inside a word (`node_modules`) starts no emphasis, so it stays bare.
function escape(text: string): string {
  return text
    .replaceAll(/[\\`*[\]<]/gu, "\\$&")
    .replaceAll(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
}

// Text escapes `[` and `]`, so only a link or an image writes `](`.
function endsWithLink(text: string): boolean {
  return /\]\(\S*\)$/u.test(text);
}

function startsWithLink(text: string): boolean {
  return /^!?\[/u.test(text);
}

// Two links with nothing between them are laid out apart, as a row of buttons is.
function append(out: string, piece: string): string {
  return endsWithLink(out) && startsWithLink(piece)
    ? `${out} ${piece}`
    : out + piece;
}

function inline(nodes: readonly Node[], ctx: Context): string {
  let out = "";

  for (const node of flow(nodes, ctx)) {
    if (node.type === "text") {
      out += escape(node.value.replaceAll(/\s+/gu, " "));
    } else if (node.type === "element" && !hidden(node)) {
      out = inlineElement(out, node, ctx);
    }
  }

  return out;
}

function inlineElement(out: string, node: Element, ctx: Context): string {
  switch (node.name) {
    case "br": {
      return `${out}\n`;
    }

    case "strong":
    case "b": {
      return out + wrap(inline(node.children, ctx).trim(), "**");
    }

    case "em":
    case "i": {
      return out + wrap(inline(node.children, ctx).trim(), "_");
    }

    case "code": {
      return out + codeSpan(textOf(node));
    }

    case "a": {
      return append(out, anchor(node, ctx));
    }

    case "img": {
      return out + image(node, ctx);
    }

    default: {
      return append(out, inline(node.children, ctx));
    }
  }
}

function wrap(text: string, mark: string): string {
  return text ? `${mark}${text}${mark}` : "";
}

function codeSpan(text: string): string {
  const fence = "`".repeat(
    Math.max(0, ...(text.match(/`+/gu) ?? []).map((r) => r.length)) + 1
  );

  // CommonMark strips one space on each side, so a backtick at an end needs one.
  const pad = /^`|`$/u.test(text) ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
}

function anchor(node: Element, ctx: Context): string {
  const text = inline(node.children, ctx).trim();
  const to = node.attrs.href;

  return to && text && !to.startsWith("#") && !to.startsWith("javascript:")
    ? `[${text}](${href(to, ctx)})`
    : text;
}

function image(node: Element, ctx: Context): string {
  const alt = node.attrs.alt?.trim();

  return alt && node.attrs.src
    ? `![${escape(alt)}](${href(node.attrs.src, ctx)})`
    : "";
}

function unblock(text: string): string {
  return text
    .replaceAll(/^(?<number>\d+)(?<mark>[.)])(?=\s|$)/gmu, "$<number>\\$<mark>")
    .replaceAll(/^[#>+=-]/gmu, "\\$&");
}

function clean(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replaceAll(/ {2,}/gu, " ").trim())
    .join("\n")
    .trim();
}

function indent(text: string, by: string): string {
  return text.replaceAll(/\n(?=.)/gu, `\n${by}`);
}

function list(e: Element, ctx: Context): string {
  const ordered = e.name === "ol";
  let n = Number(e.attrs.start ?? 1);
  const items: string[] = [];

  for (const item of flow(e.children, ctx)) {
    if (item.type !== "element" || item.name !== "li" || hidden(item)) {
      continue;
    }

    const body = blocks(item.children, ctx).join("\n\n");

    if (!body) {
      continue;
    }

    const marker = ordered ? `${n}. ` : "- ";
    n += 1;
    items.push(marker + indent(body, " ".repeat(marker.length)));
  }

  return items.join("\n");
}

// The table's own rows: not a hidden one, and not those of a table inside a cell.
function rowsOf(e: Element): Element[] {
  return e.children.flatMap((c) => {
    if (c.type !== "element" || hidden(c)) {
      return [];
    }

    if (c.name === "tr") {
      return [c];
    }

    return ["thead", "tbody", "tfoot"].includes(c.name) ? rowsOf(c) : [];
  });
}

function table(e: Element, ctx: Context): string {
  const rows = rowsOf(e).map((row) =>
    row.children
      .filter(
        (c): c is Element =>
          c.type === "element" &&
          (c.name === "td" || c.name === "th") &&
          !hidden(c)
      )
      .map((cell) =>
        clean(inline(cell.children, ctx).replaceAll(/\s+/gu, " ")).replaceAll(
          "|",
          "\\|"
        )
      )
  );

  const [header, ...body] = rows;

  if (!header) {
    return "";
  }

  const width = Math.max(...rows.map((r) => r.length));

  function line(cells: string[]): string {
    return `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  }

  return [
    line(header),
    line(Array.from({ length: width }, () => "---")),
    ...body.map(line),
  ].join("\n");
}

function block(e: Element, ctx: Context): string[] {
  if (/^h[1-6]$/u.test(e.name)) {
    const text = clean(inline(e.children, ctx).replaceAll("\n", " "));

    return text ? [`${"#".repeat(Number(e.name.slice(1)))} ${text}`] : [];
  }

  switch (e.name) {
    case "hr": {
      return ["---"];
    }

    case "ul":
    case "ol": {
      const text = list(e, ctx);

      return text ? [text] : [];
    }

    case "pre": {
      const code = find(e, (c) => c.name === "code");

      const lang =
        /\blanguage-(?<lang>\S+)/u.exec(code?.attrs.class ?? "")?.groups
          ?.lang ?? "";

      const text = textOf(e).replace(/\n$/u, "");

      // One backtick longer than the longest run inside, as in codeSpan().
      const fence = "`".repeat(
        Math.max(2, ...(text.match(/`+/gu) ?? []).map((r) => r.length)) + 1
      );

      return [`${fence}${lang}\n${text}\n${fence}`];
    }

    case "blockquote": {
      const text = blocks(e.children, ctx).join("\n\n");

      return text
        ? [text.replaceAll(/^/gmu, "> ").replaceAll(/^> $/gmu, ">")]
        : [];
    }

    case "table": {
      const text = table(e, ctx);

      return text ? [text] : [];
    }

    case "form": {
      return form(e, ctx);
    }

    default: {
      return blocks(e.children, ctx);
    }
  }
}

function blank(node: Node): boolean {
  return (
    node.type === "comment" ||
    (node.type === "text" && !node.value.trim()) ||
    (node.type === "element" && hidden(node))
  );
}

function onlyLink(node: Node, ctx: Context): Element | undefined {
  if (node.type !== "element" || BLOCK.has(node.name)) {
    return undefined;
  }

  if (node.name === "a") {
    return node;
  }

  const children = [...flow(node.children, ctx)].filter(
    (child) => !blank(child)
  );

  const [only, ...more] = children;

  return only && more.length === 0 ? onlyLink(only, ctx) : undefined;
}

function linkList(run: readonly Node[], ctx: Context): string | undefined {
  const items: string[] = [];

  for (const node of flow(run, ctx)) {
    if (blank(node)) {
      continue;
    }

    const link = onlyLink(node, ctx);

    if (!link) {
      return undefined;
    }

    const item = clean(inline([link], ctx).replaceAll("\n", " "));

    if (item) {
      items.push(`- ${item}`);
    }
  }

  return items.length > 1 ? items.join("\n") : undefined;
}

function blocks(nodes: readonly Node[], ctx: Context): string[] {
  const out: string[] = [];
  let run: Node[] = [];

  function flush() {
    const text = linkList(run, ctx) ?? unblock(clean(inline(run, ctx)));

    if (text) {
      out.push(text);
    }

    run = [];
  }

  for (const node of flow(nodes, ctx)) {
    if (node.type === "element" && hidden(node)) {
      continue;
    }

    if (node.type === "element" && BLOCK.has(node.name)) {
      flush();
      out.push(...block(node, ctx));
    } else {
      run.push(node);
    }
  }

  flush();

  return out;
}

interface FormContext {
  form: Element;
  done: Set<Element>;
  out: string[];
  fields: string[];
}

function oneLine(text: string): string {
  return clean(text.replaceAll(/\s+/gu, " "));
}

function isControl(e: Element): boolean {
  return (
    (e.name === "select" || e.name === "textarea" || e.name === "input") &&
    !/^(?:hidden|submit|reset|button|image)$/iu.test(e.attrs.type ?? "")
  );
}

function isChoice(e: Element): boolean {
  return (
    e.name === "input" && /^(?:radio|checkbox)$/iu.test(e.attrs.type ?? "")
  );
}

function isRequired(e: Element): boolean {
  return "required" in e.attrs || e.attrs["aria-required"] === "true";
}

function controlsIn(e: Element, out: Element[] = []): Element[] {
  for (const child of e.children) {
    if (child.type !== "element" || concealed(child)) {
      continue;
    }

    if (isControl(child)) {
      out.push(child);
    } else if (!SKIP.has(child.name)) {
      controlsIn(child, out);
    }
  }

  return out;
}

function byId(fc: FormContext, id: string | undefined): Element | undefined {
  return id ? controlsIn(fc.form).find((c) => c.attrs.id === id) : undefined;
}

function forLabel(fc: FormContext, control: Element): Element | undefined {
  return control.attrs.id
    ? find(
        fc.form,
        (e) => e.name === "label" && e.attrs.for === control.attrs.id
      )
    : undefined;
}

function field(label: string, required: boolean, options: string[]): string {
  let text = oneLine(label);

  if (required) {
    text = oneLine(text.replace(/\s*\\\*(?=\s|$)/u, ""));
  }

  if (!text) {
    return "";
  }

  const choices = options.filter(Boolean);

  return `- ${unblock(text)}${required ? " \\*" : ""}${choices.length ? `: ${choices.join(", ")}` : ""}`;
}

// The parts of a label are often boxes with no space between them (the name, then help text).
function labelText(e: Element, ctx: Context): string {
  return e.children
    .map((child) =>
      child.type === "element"
        ? ` ${inline([child], ctx)} `
        : inline([child], ctx)
    )
    .join("");
}

function optionsOf(select: Element): string[] {
  return findAll(select, (e) => e.name === "option")
    .filter((o) => o.attrs.value !== "" && !("disabled" in o.attrs))
    .map((o) => oneLine(escape(textOf(o))));
}

function fieldOf(
  e: Element,
  ctx: Context,
  fc: FormContext
): string | undefined {
  if (e.name === "fieldset") {
    const controls = controlsIn(e);

    if (!controls.length || !controls.every(isChoice)) {
      return undefined;
    }

    for (const c of controls) {
      fc.done.add(c);
    }

    const legend = find(e, (c) => c.name === "legend");

    const options = controls.map((c) => {
      const label =
        find(e, (l) => l.name === "label" && controlsIn(l).includes(c)) ??
        forLabel(fc, c);

      return label ? oneLine(labelText(label, ctx)) : (c.attrs.value ?? "");
    });

    return field(
      legend ? labelText(legend, ctx) : "",
      controls.some(isRequired),
      options
    );
  }

  if (e.name === "label") {
    const control = controlsIn(e)[0] ?? byId(fc, e.attrs.for);

    // The label of a control that is left out, such as a honeypot, goes with it.
    if (!control) {
      return find(e, isControl) ? "" : undefined;
    }

    if (fc.done.has(control)) {
      return undefined;
    }

    fc.done.add(control);
    const options = control.name === "select" ? optionsOf(control) : [];

    return field(labelText(e, ctx), isRequired(control), options);
  }

  if (isControl(e) && !fc.done.has(e)) {
    if (forLabel(fc, e)) {
      return "";
    }

    fc.done.add(e);
    const label = e.attrs["aria-label"] ?? e.attrs.placeholder ?? "";

    return field(label, isRequired(e), e.name === "select" ? optionsOf(e) : []);
  }

  return undefined;
}

function hasFields(e: Element, fc: FormContext): boolean {
  function open(c: Element | undefined): boolean {
    return c !== undefined && !fc.done.has(c);
  }

  return (
    controlsIn(e).some(open) ||
    findAll(e, (l) => l.name === "label" && open(byId(fc, l.attrs.for)))
      .length > 0
  );
}

function pushPart(fc: FormContext, part: string) {
  if (fc.fields.length) {
    fc.out.push(fc.fields.join("\n"));
  }

  fc.fields = [];
  fc.out.push(part);
}

function formBlocks(
  nodes: readonly Node[],
  ctx: Context,
  fc: FormContext
): void {
  let run: Node[] = [];

  function flush() {
    const part = linkList(run, ctx) ?? unblock(clean(inline(run, ctx)));

    if (part) {
      pushPart(fc, part);
    }

    run = [];
  }

  for (const node of flow(nodes, ctx)) {
    if (node.type !== "element") {
      run.push(node);
      continue;
    }

    if (concealed(node)) {
      continue;
    }

    const item = fieldOf(node, ctx, fc);

    if (item !== undefined) {
      flush();

      if (item) {
        fc.fields.push(item);
      }
    } else if (hasFields(node, fc)) {
      flush();
      formBlocks(node.children, ctx, fc);
    } else if (BLOCK.has(node.name)) {
      flush();

      for (const part of block(node, ctx)) {
        pushPart(fc, part);
      }
    } else if (!SKIP.has(node.name)) {
      run.push(node);
    }
  }

  flush();
}

function form(e: Element, ctx: Context): string[] {
  const fc: FormContext = { form: e, done: new Set(), out: [], fields: [] };
  formBlocks(e.children, ctx, fc);

  if (fc.fields.length) {
    fc.out.push(fc.fields.join("\n"));
  }

  return fc.out;
}

function frontMatter(fields: Record<string, string | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

  return lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
}

function read(html: string, url?: string) {
  const root = parse(html);
  const head = readHead(root);
  const streamed = new Map<string, Element>();

  for (const t of findAll(root, (e) => e.name === "template")) {
    if (t.attrs.id && !t.attrs.id.startsWith("pl-")) {
      streamed.set(t.attrs.id, t);
    }
  }

  const body =
    find(root, (e) => e.name === "main") ??
    find(root, (e) => e.name === "body") ??
    root;

  const base = head.canonical ?? url;

  return { head, base, parts: blocks(body.children, { base, streamed }) };
}

export function markdownCopy(html: string, url?: string) {
  const { head, base, parts } = read(html, url);

  const matter = frontMatter({
    title: head.title,
    description: head.description,
    url: base,
    modified: head.modified,
  });

  return { markdown: `${matter}${parts.join("\n\n")}\n`, head };
}

/**
 * The words an agent reads in a page, for comparing the server HTML with
 * the hydrated document: both go through the same rules.
 */
export function words(html: string): Set<string> {
  const text = read(html)
    .parts.join(" ")
    .replaceAll(/\]\([^)]*\)/gu, "]");

  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu));
}
