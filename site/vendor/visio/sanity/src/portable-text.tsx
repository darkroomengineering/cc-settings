import {
  LIST_NEST_MODE_HTML,
  buildMarksTree,
  isPortableTextBlock,
  isPortableTextToolkitList,
  isPortableTextToolkitSpan,
  isPortableTextToolkitTextNode,
  nestLists,
  spanToPlainText,
} from "@portabletext/toolkit";
import type {
  ToolkitNestedPortableTextSpan,
  ToolkitPortableTextListItem,
  ToolkitPortableTextHtmlList,
  ToolkitPortableTextList,
  ToolkitTextNode,
} from "@portabletext/toolkit";
import type {
  ArbitraryTypedObject,
  PortableTextBlock,
  TypedObject,
} from "@portabletext/types";
import type { JSX } from "@solidjs/web";
import { For, createMemo, untrack } from "solid-js";
import type { Component } from "solid-js";

import { safeHref } from "./href.ts";

export type {
  ArbitraryTypedObject,
  PortableTextBlock,
  TypedObject,
} from "@portabletext/types";

export interface PortableTextTypeProps<
  V extends TypedObject = ArbitraryTypedObject,
> {
  value: V;
  isInline: boolean;
}

export interface PortableTextMarkProps<
  V extends TypedObject = ArbitraryTypedObject,
> {
  /** The annotation's data; undefined for a decorator. */
  value: V | undefined;
  markType: string;
  text: string;
  children: JSX.Element;
}

export interface PortableTextBlockProps {
  value: PortableTextBlock;
  children: JSX.Element;
}

export interface PortableTextListProps {
  value: ToolkitPortableTextHtmlList;
  children: JSX.Element;
}

export interface PortableTextListItemProps {
  value: ToolkitPortableTextListItem;
  children: JSX.Element;
}

type ByName<P extends object> = Record<string, Component<P> | undefined>;

export interface PortableTextComponents {
  types?: ByName<PortableTextTypeProps>;
  marks?: ByName<PortableTextMarkProps>;
  block?: ByName<PortableTextBlockProps>;
  list?: ByName<PortableTextListProps>;
  listItem?: ByName<PortableTextListItemProps>;
}

const DEFAULT_BLOCKS = {
  normal: (props) => <p>{props.children}</p>,
  h1: (props) => <h1>{props.children}</h1>,
  h2: (props) => <h2>{props.children}</h2>,
  h3: (props) => <h3>{props.children}</h3>,
  h4: (props) => <h4>{props.children}</h4>,
  h5: (props) => <h5>{props.children}</h5>,
  h6: (props) => <h6>{props.children}</h6>,
  blockquote: (props) => <blockquote>{props.children}</blockquote>,
} satisfies ByName<PortableTextBlockProps>;

const DEFAULT_MARKS = {
  strong: (props) => <strong>{props.children}</strong>,
  em: (props) => <em>{props.children}</em>,
  code: (props) => <code>{props.children}</code>,
  underline: (props) => <u>{props.children}</u>,
  "strike-through": (props) => <s>{props.children}</s>,
  link: (props) => {
    function href() {
      // SAFETY: <PortableText> passed the link's href through safeHref().
      return props.value?.href as string | undefined;
    }

    // Another site opens in a new tab, without a handle back on this one.
    function external() {
      return /^https?:/iv.test(href() ?? "");
    }

    return (
      <a
        href={href()}
        target={external() ? "_blank" : undefined}
        rel={external() ? "noopener noreferrer" : undefined}
      >
        {props.children}
      </a>
    );
  },
} satisfies ByName<PortableTextMarkProps>;

const DEFAULT_LISTS = {
  bullet: (props) => <ul>{props.children}</ul>,
  number: (props) => <ol>{props.children}</ol>,
} satisfies ByName<PortableTextListProps>;

function DefaultListItem(props: PortableTextListItemProps) {
  return <li>{props.children}</li>;
}

const DEFAULT_LIST_ITEMS = {
  bullet: DefaultListItem,
  number: DefaultListItem,
} satisfies ByName<PortableTextListItemProps>;

function UnknownMark(props: PortableTextMarkProps) {
  return <>{props.children}</>;
}

function UnknownBlockStyle(props: PortableTextBlockProps) {
  return <p>{props.children}</p>;
}

/** So a changing value does not repeat the warning. */
const warned = new Set<string>();

function pick<P extends object>(
  entry: ByName<P> | undefined,
  name: string,
  defaults: ByName<P>,
  fallback: Component<P>
): Component<P> {
  return entry?.[name] ?? defaults[name] ?? fallback;
}

function blocksOf(value: PortableTextProps["value"]): TypedObject[] {
  if (!value) {
    return [];
  }

  return "_type" in value ? [value] : [...value];
}

function text(node: ToolkitTextNode): JSX.Element {
  if (!node.text.includes("\n")) {
    return node.text;
  }

  const lines = node.text.split("\n");

  return lines.map((line, i) => (i === 0 ? line : [<br />, line]));
}

/** A Portable Text field. Typegen marks `children` and `text` optional, which `PortableTextBlock` does not accept. */
export type PortableTextValue = readonly TypedObject[];

export interface PortableTextProps {
  value: PortableTextValue | TypedObject | null | undefined;
  /** Read once: configuration, not state. */
  components?: PortableTextComponents;
}

export function PortableText(props: PortableTextProps) {
  const c = untrack(() => props.components) ?? {};

  const nodes = createMemo(() =>
    nestLists(blocksOf(props.value), LIST_NEST_MODE_HTML)
  );

  function type(value: TypedObject, isInline: boolean): JSX.Element {
    const Type = c.types?.[value._type];

    if (!Type) {
      if (import.meta.env.DEV && !warned.has(value._type)) {
        warned.add(value._type);
        console.warn(
          `[@visio/sanity] <PortableText> has no component for the type "${value._type}" and renders nothing for it. ` +
            `Add \`${value._type}\` to components.types in the components the site passes (ui/rich-text).`
        );
      }

      return null;
    }

    // SAFETY: a block is a JSON object, and ArbitraryTypedObject only adds its fields as unknown.
    return <Type value={value as ArbitraryTypedObject} isInline={isInline} />;
  }

  function inline(
    node: ToolkitTextNode | ToolkitNestedPortableTextSpan | TypedObject
  ): JSX.Element {
    if (isPortableTextToolkitTextNode(node)) {
      return text(node);
    }

    if (isPortableTextToolkitSpan(node)) {
      const Resolved = pick(c.marks, node.markType, DEFAULT_MARKS, UnknownMark);
      const def = node.markDef;

      const value =
        def && "href" in def ? { ...def, href: safeHref(def.href) } : def;

      return (
        <Resolved
          value={value}
          markType={node.markType}
          text={spanToPlainText(node)}
        >
          {node.children.map(inline)}
        </Resolved>
      );
    }

    if (isPortableTextToolkitList(node)) {
      return list(node);
    }

    return type(node, true);
  }

  function content(value: PortableTextBlock): JSX.Element {
    return buildMarksTree(value).map(inline);
  }

  function textBlock(value: PortableTextBlock): JSX.Element {
    const Block = pick(
      c.block,
      value.style ?? "normal",
      DEFAULT_BLOCKS,
      UnknownBlockStyle
    );

    return <Block value={value}>{content(value)}</Block>;
  }

  function list(node: ToolkitPortableTextList): JSX.Element {
    // SAFETY: nestLists() runs in HTML mode, which makes only HTML lists.
    const html = node as ToolkitPortableTextHtmlList;

    const List = pick(
      c.list,
      html.listItem,
      DEFAULT_LISTS,
      DEFAULT_LISTS.bullet
    );

    return <List value={html}>{html.children.map(listItem)}</List>;
  }

  function listItem(item: ToolkitPortableTextListItem): JSX.Element {
    const Item = pick(
      c.listItem,
      item.listItem,
      DEFAULT_LIST_ITEMS,
      DefaultListItem
    );

    if (!item.style || item.style === "normal") {
      // SAFETY: a list item is a block; buildMarksTree() passes its nested lists through as typed objects.
      return <Item value={item}>{content(item as PortableTextBlock)}</Item>;
    }

    // A styled item (a heading in a list) renders that style's block inside
    // the li, and a deeper list after the block, not in it.
    const nested = item.children.filter(isPortableTextToolkitList);

    const inlines = item.children.filter(
      (child) => !isPortableTextToolkitList(child)
    );

    // SAFETY: without its nested lists and its listItem, the item is a plain block.
    const block = {
      ...item,
      children: inlines,
      listItem: undefined,
    } as PortableTextBlock;

    return (
      <Item value={item}>
        {textBlock(block)}
        {nested.map(list)}
      </Item>
    );
  }

  function topLevel(node: TypedObject | ToolkitPortableTextList): JSX.Element {
    if (isPortableTextToolkitList(node)) {
      return list(node);
    }

    if (isPortableTextBlock(node)) {
      return textBlock(node);
    }

    return type(node, false);
  }

  return <For each={nodes()}>{(node) => topLevel(node)}</For>;
}
