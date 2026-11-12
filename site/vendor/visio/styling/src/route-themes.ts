import type {
  HeadAddition,
  RouterExtension,
  TableEntry,
} from "@visio/router/internal/extend";
import { createEffect, NotReadyError, onSettled } from "solid-js";

import { manageRoot, restored, restoreTheme, theme } from "./theme.ts";
import type { Tokens, TokenSource } from "./tokens/index.ts";

/**
 * The site's route themes, for the types of `meta.theme`:
 * `declare module '@visio/styling' { interface Register { themes: typeof themes } }`.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- the site's declaration fills it.
export interface Register {}

/** A theme a page names in `meta`: `light`, the base palette, or a theme of the tokens. */
export type RouteTheme = Register extends { themes: RouteThemes<infer N> }
  ? N
  : never;

type ThemeNames<S extends TokenSource> =
  | "light"
  | Extract<keyof NonNullable<S["themes"]>, string>;

export interface RouteThemes<N extends string> extends RouterExtension<
  N | undefined
> {
  /** `light` and the token themes. */
  readonly names: readonly N[];
}

type HeadTag = NonNullable<HeadAddition["always"]>[number];

type MetaArgs = Parameters<NonNullable<RouterExtension["head"]>>[1];

/**
 * The page's theme from its `meta`, for `extensions` of `defineRoutes()`:
 * `<html data-theme>` before the first paint and on every page after, and
 * `theme-color` from `colors.page`.
 */
export function routeThemes<const S extends TokenSource>(
  t: Tokens<S>
): RouteThemes<ThemeNames<S>> {
  const { colors, themes = {} } = t.source;
  const { page } = colors;

  if (page === undefined) {
    throw new TypeError(
      "[@visio/styling] [PAGE_COLOR_MISSING] routeThemes() writes theme-color from colors.page, and the tokens have none. Add colors.page, the page background, and set it in each theme whose background differs (.claude/skills/styling/SKILL.md)."
    );
  }

  const base: string = page;
  // SAFETY: `light` and the keys of the tokens' themes are ThemeNames<S>.
  const names = ["light", ...Object.keys(themes)] as ThemeNames<S>[];
  const known = new Set<string>(names);

  function pageColor(name: string): string {
    return themes[name]?.page ?? base;
  }

  function themeOf(entry: TableEntry, args: MetaArgs) {
    // The type is the site's registered themes; the set catches a theme from untyped data.
    const name: string | undefined = entry.meta?.(args).theme;

    if (name === undefined) {
      return;
    }

    if (!known.has(name)) {
      throw new TypeError(
        `[@visio/styling] [THEME_UNKNOWN] meta() of ${args.location.pathname} returns theme ${JSON.stringify(name)}, which is not light or a theme of the tokens (${names.join(", ")}).`
      );
    }

    // SAFETY: `known` holds exactly the names.
    return name as ThemeNames<S>;
  }

  function tags(name: string | undefined): HeadTag[] {
    if (name === undefined) {
      return "dark" in themes
        ? [
            {
              tag: "meta",
              props: {
                name: "theme-color",
                media: "(prefers-color-scheme: light)",
                content: base,
              },
              key: "theme-color",
            },
            {
              tag: "meta",
              props: {
                name: "theme-color",
                media: "(prefers-color-scheme: dark)",
                content: pageColor("dark"),
              },
              key: "theme-color:dark",
            },
          ]
        : [
            {
              tag: "meta",
              props: { name: "theme-color", content: base },
              key: "theme-color",
            },
          ];
    }

    return [
      {
        tag: "meta",
        props: { name: "theme-color", content: pageColor(name) },
        key: "theme-color",
      },
      // In the head, so `<html>` has the theme before the body paints, on a streamed page too.
      {
        tag: "script",
        props: {
          children: `document.documentElement.dataset.theme=${JSON.stringify(name)}`,
        },
        key: "route-theme",
      },
    ];
  }

  return {
    names,
    head: (entry, args) => ({ always: tags(themeOf(entry, args)) }),
    state(entry, args) {
      // The head reports a meta() that throws; here it only means no theme, so the app keeps running.
      let name: ThemeNames<S> | undefined;

      try {
        name = themeOf(entry, args);
      } catch (error) {
        if (error instanceof NotReadyError) {
          throw error;
        }
      }

      return name;
    },
    root(state, children) {
      createEffect(
        // A page without a theme shows the visitor's, once restoreTheme() has read it.
        () => state() ?? (restored() ? theme() : undefined),
        (name) => {
          if (name !== undefined) {
            document.documentElement.dataset.theme = name;
          }
        }
      );
      onSettled(() => {
        manageRoot();

        if (!restored()) {
          restoreTheme();
        }
      });

      return children();
    },
  };
}
