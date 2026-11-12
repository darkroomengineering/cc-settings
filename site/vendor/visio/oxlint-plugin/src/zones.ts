export const THROUGH_VISIO =
  "The build is one visio() call from `visio`: it adds this plugin in its place, with the guards a hand-wired config skips (the Solid version check, the env facts, the password gate). Read .claude/skills/visio/SKILL.md.";

/** Every `@visio/<package>/internal/...` and `visio/internal/...` entry: what visio's own packages import from each other. */
export const INTERNAL = "{@visio/*,visio}/internal/**";

export const INTERNAL_ONLY =
  "An internal entry is for visio's own packages. visio() in vite.config.ts adds every plugin, and each package's call in `extensions` adds its own, such as sanity() for Sanity's routes, with the guards a hand-wired config skips, and the outlet sets a page's head from `meta` in defineRoute. Read .claude/skills/visio/SKILL.md.";

export const REACT = ["react", "react-dom", "sanity", "styled-components"];

export const VISIO_PLUGINS = ["@solidjs/vite-plugin"];
