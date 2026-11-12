import type {
  ReferenceFilterResolver,
  SchemaTypeDefinition,
} from "@sanity/types";
import { defineConfig } from "sanity";
import type { PluginOptions, SingleWorkspace } from "sanity";
import { presentationTool } from "sanity/presentation";
import type { PresentationPluginOptions } from "sanity/presentation";
import { structureLocaleNamespace, structureTool } from "sanity/structure";
import type {
  ListItemBuilder,
  StructureBuilder,
  StructureResolver,
  StructureResolverContext,
  StructureToolOptions,
} from "sanity/structure";

import { API_VERSION, DEFAULT_API_PATH } from "./constants.ts";
import { isTranslated } from "./languages.ts";
import type { StudioLanguages, Translated } from "./languages.ts";

/** What `defineStudio()` returns: the Studio's config, one workspace, for `export default`. */
export type Studio = SingleWorkspace;

/** The names of the document types in `types`: literal with `defineType`, any string without. */
export type DocumentName<Types extends readonly SchemaTypeDefinition[]> =
  string extends Types[number]["name"]
    ? string
    : Extract<Types[number], { type: "document" }>["name"];

/** The names of the document types `translated()` returned. */
export type TranslatedName<Types extends readonly SchemaTypeDefinition[]> =
  Extract<Types[number], Translated>["name"];

export type StructureArgs<
  Singleton extends string,
  TranslatedType extends string = never,
  Lang extends string = never,
> = StructureResolverContext & {
  singleton: {
    /** The list item of a singleton, with its title from `singletons`; translated, a list of its languages. */
    (type: Singleton): ListItemBuilder;
    /** The list item of a translated singleton in one language. */
    (type: Singleton & TranslatedType, lang: Lang): ListItemBuilder;
  };
  /** The list item of a translated type, with a list for each language. */
  languageList: (type: Exclude<TranslatedType, Singleton>) => ListItemBuilder;
};

export interface StudioOptions<
  Types extends readonly SchemaTypeDefinition[] = SchemaTypeDefinition[],
  Singletons extends Partial<Record<DocumentName<Types>, string>> = Partial<
    Record<DocumentName<Types>, string>
  >,
  Lang extends string = never,
> {
  /** The name in the Studio's top bar. */
  title: string;
  /** `schemaTypes` from `./schemaTypes`, the list typegen reads. */
  types: Types;
  /** `languages` from `./schemaTypes/languages`, the result of `defineStudioLanguages()`. */
  languages?: StudioLanguages<Lang>;
  /** Titles by document type. */
  singletons?: Singletons &
    Record<
      Exclude<keyof Singletons, DocumentName<Types>>,
      "[@visio/sanity] Not a document type in schemaTypes"
    >;
  /** Sanity's structure tool options. */
  structureTool?: Omit<
    StructureToolOptions,
    "name" | "source" | "structure"
  > & {
    structure?: (
      S: StructureBuilder,
      args: StructureArgs<
        keyof Singletons & string,
        TranslatedName<Types>,
        Lang
      >
    ) => ReturnType<StructureResolver>;
  };
  /** Sanity's Presentation options. */
  presentationTool?: Omit<
    PresentationPluginOptions,
    "name" | "previewUrl" | "locate"
  >;
  /** Plugins of the site's own, such as a locale. */
  plugins?: PluginOptions[];
  /** Content releases and scheduled drafts. Default false. */
  releases?: boolean;
  /** Tasks. Default false. */
  tasks?: boolean;
}

/** What would leave the site without a singleton, or with a second one. */
const SINGLETON_REMOVED = new Set([
  "delete",
  "unpublish",
  "unpublishVersion",
  "duplicate",
]);

/** What `defineStudio()` adds, by plugin and tool name: `presentationTool()` has only a tool name. */
const OWN_PLUGINS = new Set(["sanity/structure", "structure", "presentation"]);

function pluginNames(plugin: PluginOptions): string[] {
  if (!plugin) {
    return [];
  }

  const tools = Array.isArray(plugin.tools)
    ? plugin.tools.map((tool) => tool.name)
    : [];

  return [
    ...new Set(
      [plugin.name, ...tools].filter((name): name is string => !!name)
    ),
  ];
}

/** A field, an array member or an annotation, as the walk reads it. */
interface SchemaNode {
  name?: string;
  type?: string;
  to?: readonly { type?: string }[];
  options?: { filter?: unknown };
  fields?: readonly SchemaNode[];
  of?: readonly SchemaNode[];
  marks?: { annotations?: readonly SchemaNode[] };
}

/** Each reference whose filter is `filter`, as the path to it and its target type. */
function sameLanguageTargets(
  node: SchemaNode,
  filter: ReferenceFilterResolver,
  at: string
): { at: string; target: string }[] {
  const own =
    node.type === "reference" && node.options?.filter === filter
      ? (node.to ?? []).flatMap(({ type }) =>
          type ? [{ at, target: type }] : []
        )
      : [];

  return [
    ...own,
    ...[
      ...(node.fields ?? []),
      ...(node.of ?? []),
      ...(node.marks?.annotations ?? []),
    ].flatMap((next) =>
      sameLanguageTargets(next, filter, next.name ? `${at}.${next.name}` : at)
    ),
  ];
}

/** The language parts of the Studio, checked against `types`. */
function languageParts(
  types: readonly SchemaTypeDefinition[],
  languages: StudioLanguages | undefined
) {
  const translated = new Set(
    types
      .values()
      .filter((t) => isTranslated(t))
      .map((t) => t.name)
  );

  if (!languages) {
    const [first] = translated;

    if (first !== undefined) {
      throw new Error(
        `[@visio/sanity] [STUDIO_LANGUAGES_NOT_PASSED] "${first}" is translated, but defineStudio() has no languages. Pass languages from ./schemaTypes/languages.`
      );
    }

    return;
  }

  for (const type of types) {
    // SAFETY: a schema type is a plain object of fields, array members and annotations.
    const node = type as SchemaNode;

    for (const { at, target } of sameLanguageTargets(
      node,
      languages.sameLanguage,
      type.name
    )) {
      if (!translated.has(target)) {
        throw new Error(
          `[@visio/sanity] [SAME_LANGUAGE_TARGET_UNTRANSLATED] ${at} filters with languages.sameLanguage, but "${target}" is not translated, so the field would find no document. Remove the filter, or wrap "${target}" in languages.translated().`
        );
      }
    }
  }

  return { languages, translated };
}

/** The document id of a singleton in a language: the type itself in the default one. */
function singletonId(languages: StudioLanguages, type: string, lang: string) {
  return lang === languages.default ? type : `${type}-${lang}`;
}

export function defineStudio<
  const Types extends readonly SchemaTypeDefinition[],
  const Singletons extends Partial<Record<DocumentName<Types>, string>> =
    Record<never, never>,
  const Lang extends string = never,
>(options: StudioOptions<Types, Singletons, Lang>): Studio {
  const singletons = new Map(Object.entries<string>(options.singletons ?? {}));

  const documents = new Set(
    options.types.filter((t) => t.type === "document").map((t) => t.name)
  );

  for (const type of singletons.keys()) {
    if (!documents.has(type)) {
      throw new Error(
        `[@visio/sanity] [SINGLETON_TYPE_UNKNOWN] singletons lists "${type}", which is no document type in schemaTypes. Define it in studio/schemaTypes/ or remove it from singletons.`
      );
    }
  }

  const parts = languageParts(options.types, options.languages);
  const translated = parts?.translated ?? new Set<string>();

  /** The translated types that are not singletons: one template and one list per language. */
  const translatedDocuments = [...translated].filter(
    (type) => !singletons.has(type)
  );

  const seen = new Set<string>();

  for (const plugin of options.plugins ?? []) {
    const names = pluginNames(plugin);
    const twice = names.find((name) => OWN_PLUGINS.has(name) || seen.has(name));

    if (twice) {
      console.warn(
        `[@visio/sanity] [STUDIO_PLUGIN_DUPLICATE] The plugin "${twice}" is in the Studio twice. defineStudio() adds the structure and Presentation itself: pass their options as \`structureTool\` and \`presentationTool\`.`
      );
    }

    for (const name of names) {
      seen.add(name);
    }
  }

  const api = process.env.SANITY_STUDIO_API_PATH || DEFAULT_API_PATH;
  const releases = options.releases ?? false;

  function singletonDefinitions([type, title]: [string, string]) {
    if (!parts || !translated.has(type)) {
      return [{ id: type, schemaType: type, documentId: type, title }];
    }

    const { languages } = parts;

    return Object.entries(languages.titles).map(([lang, name]) => {
      const id = singletonId(languages, type, lang);

      return {
        id,
        schemaType: type,
        documentId: id,
        title: `${title} (${name})`,
        // A weak reference: the original may not be published yet. Sanity strengthens it on publish.
        initialValue:
          lang === languages.default
            ? { language: lang }
            : {
                language: lang,
                translationOf: {
                  _type: "reference",
                  _ref: type,
                  _weak: true,
                  _strengthenOnPublish: { type },
                },
              },
      };
    });
  }

  function typeTitle(type: string): string {
    return options.types.find((t) => t.name === type)?.title ?? type;
  }

  return defineConfig({
    name: "default",
    title: options.title,
    // `defineConfig` throws on an empty id, which would break the build before a project exists.
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || "unset",
    dataset: process.env.SANITY_STUDIO_DATASET || "production",
    plugins: [
      structureTool({
        ...options.structureTool,
        structure: (S, context) => {
          function languageEntries(
            languages: StudioLanguages,
            type: string,
            title: string
          ) {
            return S.list()
              .id(type)
              .title(title)
              .items(
                Object.entries(languages.titles).map(([lang, name]) =>
                  S.listItem()
                    .singleton(singletonId(languages, type, lang))
                    .title(name)
                )
              );
          }

          function singleton(type: string, lang?: string) {
            if (!parts || !translated.has(type)) {
              return S.listItem().singleton(type);
            }

            const { languages } = parts;

            if (lang !== undefined) {
              return S.listItem().singleton(singletonId(languages, type, lang));
            }

            const title = singletons.get(type) ?? type;

            return S.listItem()
              .id(type)
              .title(title)
              .child(languageEntries(languages, type, title));
          }

          function languageList(type: string) {
            // Its type takes only a translated type, and a translated type needs languages.
            if (!parts) {
              return S.documentTypeListItem(type);
            }

            const { languages } = parts;
            const title = typeTitle(type);

            return S.documentTypeListItem(type).child(
              S.list()
                .id(type)
                .title(title)
                .items(
                  Object.entries(languages.titles).map(([lang, name]) => {
                    const id = `${type}-${lang}`;

                    return S.listItem()
                      .id(id)
                      .title(name)
                      .child(
                        S.documentTypeList(type)
                          .id(id)
                          .title(`${title} (${name})`)
                          .filter("_type == $type && language == $language")
                          .params({ type, language: lang })
                          .apiVersion(API_VERSION)
                          .initialValueTemplates([
                            S.initialValueTemplateItem(id),
                          ])
                      );
                  })
                )
            );
          }

          const own = options.structureTool?.structure;

          if (own) {
            return own(S, { ...context, singleton, languageList });
          }

          const ordered = [
            ...[...singletons.keys()].filter((type) => translated.has(type)),
            ...[...singletons.keys()].filter((type) => !translated.has(type)),
          ];

          const items = ordered.map((type) => singleton(type));

          const rest = [
            ...translatedDocuments.map(languageList),
            ...S.documentTypeListItems().filter(
              (item) => !translated.has(item.getId() ?? "")
            ),
          ];

          // Sanity's own key for the root title, so a locale plugin translates it.
          return S.list()
            .title("Content")
            .i18n({
              title: {
                key: "default-definition.content-title",
                ns: structureLocaleNamespace,
              },
            })
            .items(items.length ? [...items, S.divider(), ...rest] : rest);
        },
      }),
      presentationTool({
        ...options.presentationTool,
        previewUrl: {
          initial: "/",
          previewMode: { enable: `${api}/enable`, disable: `${api}/disable` },
        },
      }),
      ...(options.plugins ?? []),
    ],
    releases: { enabled: releases },
    scheduledDrafts: { enabled: releases },
    scheduledPublishing: { enabled: false },
    tasks: { enabled: options.tasks ?? false },
    schema: {
      types: [...options.types],
      ...(parts && {
        // "New document" asks for the language: no translated document starts without one.
        templates: (previous) => [
          ...previous.filter(
            (t) =>
              !(t.id === t.schemaType && translatedDocuments.includes(t.id))
          ),
          ...translatedDocuments.flatMap((type) =>
            Object.entries(parts.languages.titles).map(([lang, name]) => ({
              id: `${type}-${lang}`,
              title: `${typeTitle(type)} (${name})`,
              schemaType: type,
              value: { language: lang },
            }))
          ),
        ],
      }),
    },
    document: {
      // Beta in sanity 6.18: this file is the only one that calls it.
      singletons: [...singletons].flatMap(singletonDefinitions),
      actions: (actions, context) =>
        context.singleton
          ? actions.filter(
              ({ action }) => !action || !SINGLETON_REMOVED.has(action)
            )
          : actions,
    },
  });
}
