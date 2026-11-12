# The Studio

```ts
// studio/sanity.config.ts
import { defineStudio } from "@visio/sanity/studio";

import { schemaTypes } from "./schemaTypes";

export default defineStudio({
  title: "Client name",
  types: schemaTypes,
  singletons: { siteSettings: "Settings", homePage: "Home" },
});
```

```ts
// studio/sanity.cli.ts, the whole file
export { default } from "@visio/sanity/studio/cli";
```

- `defineStudio()` adds the project, the structure, and Presentation on the draft mode routes. The build stops when either file is anything else (`STUDIO_CONFIG_UNMANAGED`, `STUDIO_CLI_UNMANAGED`).
- A page or settings document that exists once (home, settings, contact) goes in `singletons`, with its title. Its document id is the type's name, so a query reads it as `*[_id == "homePage"][0]`. Editors cannot create a second one, delete it, unpublish it (also through a release) or duplicate it; every other action, a plugin's included, stays.
- `structureTool` and `presentationTool` take the tools' own Sanity options, as in Sanity's docs. visio sets Presentation's `previewUrl` (the draft mode routes) and both `name`s.
- The default structure lists the singletons, then every other document type. For groups or custom titles, pass `structureTool: { structure: (S, { singleton }) => S.list().title('Content').items([...]) }`, and list a singleton with `singleton('homePage')`. Both `singletons` and `singleton()` are typed from `schemaTypes`, so a wrong name is a type error.
- `presentationTool: { resolve }` tells Presentation where a document appears on the site (`locations`, `mainDocuments` from `sanity/presentation`).
- A site in another language sets the tab titles, which no locale plugin translates: `structureTool: { title: 'Inhalt' }`, `presentationTool: { title: 'Vorschau' }`.
- `plugins` takes the rest, such as a locale (`deDELocale()` from `@sanity/locale-de-de`). A plugin that is in the Studio twice warns `STUDIO_PLUGIN_DUPLICATE` in the browser console.
- Releases with scheduled drafts (`releases: true`) and tasks (`tasks: true`) are off by default. Draft mode works with or without them.
