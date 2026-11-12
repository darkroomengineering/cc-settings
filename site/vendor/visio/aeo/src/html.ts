export interface Element {
  type: "element";
  name: string;
  attrs: Record<string, string>;
  children: Node[];
}

export type Node =
  | Element
  | { type: "text"; value: string }
  | { type: "comment"; value: string };

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const RAW = new Set(["script", "style", "textarea", "title"]);

const TAG =
  /<(?<name>[a-zA-Z][\w:-]*)(?<attrs>(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/uy;

const ATTR =
  /(?<key>[^\s"'>/=]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gu;

const NAMED = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["hellip", "…"],
  ["mdash", "—"],
  ["ndash", "–"],
  ["rsquo", "’"],
  ["lsquo", "‘"],
  ["rdquo", "”"],
  ["ldquo", "“"],
  ["copy", "©"],
]);

/** A named group the pattern always fills when it matches. */
function group(match: RegExpExecArray, key: string): string {
  const value = match.groups?.[key];

  if (value === undefined) {
    throw new Error(
      `[@visio/aeo] the "${key}" group did not take part in the match`
    );
  }

  return value;
}

export function decode(text: string): string {
  return text.replaceAll(
    /&(?<body>#x[\da-f]+|#\d+|[a-z]+);/giu,
    (entity, body: string) => {
      if (body[0] !== "#") {
        return NAMED.get(body.toLowerCase()) ?? entity;
      }

      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : +body.slice(1);

      return code > 0 && code < 0x11_00_00
        ? String.fromCodePoint(code)
        : entity;
    }
  );
}

export function parse(html: string): Element {
  const root: Element = {
    type: "element",
    name: "#root",
    attrs: {},
    children: [],
  };

  const stack: Element[] = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);

    if (lt === -1) {
      addText(stack, html.slice(i));
      break;
    }

    addText(stack, html.slice(i, lt));
    i = markup(html, lt, stack);
  }

  return root;
}

function top(stack: readonly Element[]): Element {
  const element = stack.at(-1);

  if (!element) {
    throw new Error("[@visio/aeo] the parse stack lost its root");
  }

  return element;
}

function addText(stack: readonly Element[], value: string): void {
  if (value) {
    top(stack).children.push({ type: "text", value: decode(value) });
  }
}

/** Where the text after the `>` at or after `from` starts. */
function after(html: string, from: number): number {
  const end = html.indexOf(">", from);

  return end === -1 ? html.length : end + 1;
}

/** Reads the markup that starts at `lt` and returns where the text after it starts. */
function markup(html: string, lt: number, stack: Element[]): number {
  if (html.startsWith("<!--", lt)) {
    const end = html.indexOf("-->", lt + 4);
    const stop = end === -1 ? html.length : end;
    top(stack).children.push({
      type: "comment",
      value: html.slice(lt + 4, stop),
    });

    return stop + 3;
  }

  const next = html[lt + 1];

  if (next === "!" || next === "?") {
    return after(html, lt);
  }

  if (next === "/") {
    const end = html.indexOf(">", lt);

    const name = html
      .slice(lt + 2, end === -1 ? undefined : end)
      .trim()
      .toLowerCase();

    const at = stack.findLastIndex((e) => e.name === name);

    if (at > 0) {
      stack.length = at;
    }

    return after(html, lt);
  }

  return openTag(html, lt, stack);
}

function openTag(html: string, lt: number, stack: Element[]): number {
  TAG.lastIndex = lt;
  const tag = TAG.exec(html);

  if (!tag) {
    addText(stack, "<");

    return lt + 1;
  }

  const name = group(tag, "name").toLowerCase();
  const attrs: Record<string, string> = {};

  for (const match of group(tag, "attrs").matchAll(ATTR)) {
    const { double, single, bare } = match.groups ?? {};
    attrs[group(match, "key").toLowerCase()] = decode(
      double ?? single ?? bare ?? ""
    );
  }

  const element: Element = { type: "element", name, attrs, children: [] };
  top(stack).children.push(element);
  const i = TAG.lastIndex;

  if (RAW.has(name)) {
    const close = html.toLowerCase().indexOf(`</${name}`, i);
    const stop = close === -1 ? html.length : close;
    const value = html.slice(i, stop);

    if (value) {
      element.children.push({
        type: "text",
        value: name === "title" ? decode(value) : value,
      });
    }

    return after(html, stop);
  }

  if (!VOID.has(name) && !tag[0].endsWith("/>")) {
    stack.push(element);
  }

  return i;
}

export function find(
  node: Element,
  test: (e: Element) => boolean
): Element | undefined {
  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }

    if (test(child)) {
      return child;
    }

    const found = find(child, test);

    if (found) {
      return found;
    }
  }

  return undefined;
}

export function findAll(
  node: Element,
  test: (e: Element) => boolean,
  out: Element[] = []
): Element[] {
  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }

    if (test(child)) {
      out.push(child);
    }

    findAll(child, test, out);
  }

  return out;
}

export function textOf(node: Node): string {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "comment") {
    return "";
  }

  return node.children.map(textOf).join("");
}
