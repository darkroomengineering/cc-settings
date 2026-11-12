/**
 * Types for `?responsive`, `?component` and `?defs` imports. Add
 * `@visio/image-optimizer/client` to the `types` of the app's tsconfig.
 * Plain `.svg` and `?url` imports are strings, typed by `vite/client`.
 */
// Before `*?responsive`: with equal prefixes, TypeScript takes the first match.
declare module "*.svg?responsive" {
  const image: import("@visio/image-optimizer").VectorImage;
  export default image;
}

declare module "*?responsive" {
  const image: import("@visio/image-optimizer").ResponsiveImage;
  export default image;
}

declare module "*.svg?component" {
  const Svg: import("solid-js").Component<
    import("@solidjs/web").JSX.SvgSVGAttributes<SVGSVGElement>
  >;

  export default Svg;
}

declare module "*.svg?defs" {
  const Defs: import("solid-js").Component;
  export default Defs;
}
