# Portable Text

`ui/rich-text` is `<PortableText>` from `@visio/sanity` with the site's styled components. Extend its `components` object for a project's schema:

```tsx
const components: PortableTextComponents = {
  block: { h3: (props) => <h3 class={s.h3}>{props.children}</h3> },
  marks: { highlight: (props) => <mark class={s.mark}>{props.children}</mark> },
  types: {
    image: (props) => (
      <Image src={sanityImage(props.value)} sizes={BODY_IMAGE} />
    ),
  },
};
```

- Each entry is a map. `block` is keyed by style, `list` and `listItem` by list kind, `marks` by decorator name or annotation `_type`, `types` by `_type`.
- In a mark, `props.value` is the annotation's data (`href` on a link). In a type, `props.isInline` says whether it sits in a line of text.
- A link mark of the site's own reads `props.value.href` as it is: `<PortableText>` has already dropped any scheme but `http:`, `https:`, `mailto:` and `tel:` (Solid sets a `javascript:` href as it is), so the href is `undefined` or safe.
- Anything left out falls back to a plain element (`p`, `h1`-`h6`, `blockquote`, `ul`/`ol`/`li`, `strong`, `em`, `code`, `u`, `s`, `a`, `br`).
- There is no catch-all component. A type with no entry renders nothing and warns in dev: add it to `types`. An unknown mark renders its text, an unknown style a `p`, an unknown list kind a `ul` with `li`s.
- A wrapper types the field it passes on as `PortableTextValue`, never `PortableTextBlock[]`: the query result has optional `children` and `text`, which `PortableTextBlock` rejects.
- Keep `components` at module scope. It is read once.
- Dereference what custom types need in the query: `body[]{ ..., _type == "image" => ${IMAGE} }`.
- A description or an excerpt comes from the query: `"excerpt": pt::text(body)`, typed `string`. Never convert the blocks in code.
