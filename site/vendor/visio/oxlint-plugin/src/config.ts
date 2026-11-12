import { fileURLToPath } from "node:url";

import type { OxlintConfig } from "oxlint";

import type { Zone } from "./rules/restricted-imports.ts";
import {
  INTERNAL,
  INTERNAL_ONLY,
  REACT,
  THROUGH_VISIO,
  VISIO_PLUGINS,
} from "./zones.ts";

export type { Zone } from "./rules/restricted-imports.ts";

export interface PresetOptions {
  /** App folders from the config's directory, each with `src/`. Default `['.']`. */
  apps?: string[];
  /** More zones, after the preset's own. */
  zones?: Zone[];
}

const SHELL_STILL =
  "The shell never animates itself: a page animates it through a ref prop and usePageTransition, and the nav dims with a data attribute and a CSS transition. Read .claude/skills/transitions/SKILL.md.";

const ONE_LIBRARY =
  "anime.js is the animation library of this starter, on the frame loop: import it from @visio/animate. A CSS transition is fine for a state change. Read .claude/skills/animate/SKILL.md.";

const THROUGH_VISIO_ENV =
  'Import `env` from src/env.ts by a relative path (`import { env } from "../env"`): one `defineEnv()` of @visio/env. Read .claude/skills/env/SKILL.md.';

const THROUGH_VISIO_SANITY =
  "Everything Sanity comes from @visio/sanity: fetchQuery from @visio/sanity/server, defineQuery, sanityImage, and ui/rich-text. Read .claude/skills/sanity/SKILL.md.";

function nativeScroll(name: string): string {
  return `A bare \`${name}()\` is \`window.${name}()\`: it moves the page past @visio/scroll, and fights Lenis's glide when <SmoothScroll /> runs. Scroll with \`scrollTo(target)\` from @visio/scroll, imported by name. Read .claude/skills/scroll/SKILL.md.`;
}

const OWN_LOOP =
  "Per-frame work goes through useFrame from @visio/frame (frame() outside a component), never a loop of its own. Read .claude/skills/frame/SKILL.md.";

function zones(app: (glob: string) => string[], whole: string[]): Zone[] {
  return [
    {
      // The Studio is the only React app. Hoisting can put React in the root
      // node_modules, so an import from the Solid side would still resolve.
      files: whole,
      imports: REACT.map((name) => ({
        name,
        message:
          "React and the Studio stay in studio/; the site is Solid. Read .claude/skills/sanity/SKILL.md.",
      })),
    },
    {
      // Pages and what renders inside them read `props.params`, `props.location`
      // and `props.data`. The outlet keeps the old page alive while the new one
      // enters, and the router's hooks would show it the new URL mid-transition.
      // The shell (app.tsx, state/, lib/) sees the live location and may use them.
      files: app("src/{pages,components,ui}/**"),
      imports: [
        {
          name: "@visio/router",
          importNames: [
            "useParams",
            "useLocation",
            "useSearchParams",
            "useMatch",
            "useRouteMatches",
            "useResolvedPath",
            "useIsRouting",
          ],
          message:
            'Pages read props.params, props.location and props.data; this hook shows the new URL while the old page is still animating. A shell component (a nav, a footer) takes what it needs as a prop: the root layout has props.location, and app.tsx may call the hook and pass it down. Read .claude/skills/router/SKILL.md, "Routes and pages".',
        },
      ],
    },
    {
      // In a component, useLang() is the language of the page it renders in.
      files: app("src/pages/**"),
      imports: [
        {
          name: "@visio/i18n",
          importNames: ["useLang", "useStrings"],
          message:
            "A page reads props.lang, and its words as strings[props.lang]: one way to write a page, and the language its preload and meta get too. A component the page renders calls useLang() or useStrings(). Read .claude/skills/i18n/SKILL.md.",
        },
      ],
    },
    {
      // Solid Router is the primitive under @visio/router, which re-exports
      // its data layer and hooks and owns the router instance.
      files: app("src/**"),
      imports: [
        {
          // A plain name bans its subpaths too: one message for both.
          name: "@solidjs/router",
          message:
            "Import from @visio/router: query, action, useSubmissions and the router hooks are re-exported there, defineRoutes() in src/routes.ts makes the Router and paths, and visio() wires the server side. Read .claude/skills/router/SKILL.md.",
        },
      ],
    },
    {
      // The shell loads on every page and takes part in every navigation.
      files: [
        ...app("src/app.tsx"),
        ...app("src/components/nav.tsx"),
        ...app("src/components/footer.tsx"),
        ...app("src/ui/**"),
      ],
      imports: [
        { name: "@visio/animate", message: SHELL_STILL },
        { name: "**/lib/motion{,.ts}", message: SHELL_STILL },
      ],
    },
    {
      // anime.js imported directly would run on its own requestAnimationFrame;
      // a second library would bring a loop of its own too.
      files: app("src/**"),
      imports: [
        {
          name: "animejs",
          message:
            "Import anime.js from @visio/animate: the same API, stepped on the frame loop. Read .claude/skills/animate/SKILL.md.",
        },
        {
          name: "kugiri",
          message:
            "Split text with splitText from @visio/animate, in the constructor of useAnime: it splits again after a resize and when a font loads, and reverts with the component. Read .claude/skills/animate/SKILL.md.",
        },
        ...[
          "gsap",
          "motion",
          "framer-motion",
          "popmotion",
          "@motionone/**",
          "motion-one",
          "velocity-animate",
          "@react-spring/**",
          "react-spring",
          "@theatre/**",
          "mo-js",
          "@mojs/core",
        ].map((name) => ({ name, message: ONE_LIBRARY })),
      ],
    },
    {
      // The packages fix the slots, the fps throttle and reduced motion; a
      // direct import would skip them.
      files: app("src/**"),
      imports: [
        { name: "tempus", message: OWN_LOOP },
        {
          name: "lenis",
          message:
            "Smooth scrolling is <SmoothScroll /> from @visio/scroll, and lenis() is the instance. Scroll and lock the page with scrollTo() and lockScroll() from it. Read .claude/skills/scroll/SKILL.md.",
        },
      ],
    },
    {
      // Solid's env plugin is off, so these no longer resolve; dotenv would read
      // the encrypted values as they are written.
      files: whole,
      imports: [
        "virtual:solid-env/client",
        "virtual:solid-env/server",
        "dotenv",
        "dotenv/**",
        "@dotenvx/**",
      ].map((name) => ({ name, message: THROUGH_VISIO_ENV })),
    },
    {
      files: whole,
      imports: [
        "@sanity/client",
        "groq",
        "@sanity/image-url",
        "next-sanity",
        "@portabletext/**",
      ].map((name) => ({ name, message: THROUGH_VISIO_SANITY })),
    },
    {
      files: whole,
      imports: [
        ...VISIO_PLUGINS.map((name) => ({ name, message: THROUGH_VISIO })),
        { name: INTERNAL, message: INTERNAL_ONLY },
      ],
    },
    {
      files: whole,
      except: app("src/ui/rich-text.tsx"),
      imports: [
        {
          name: "@visio/sanity",
          importNames: ["PortableText"],
          message:
            'Render Portable Text with ui/rich-text, and add a type it lacks to its `components`. Read .claude/skills/sanity/SKILL.md, "Portable Text".',
        },
      ],
    },
  ];
}

/** The visio conventions for oxlint: the plugin, its rules, and the import bans per folder. */
export function preset({ apps = ["."], zones: more = [] }: PresetOptions = {}) {
  function app(glob: string): string[] {
    return apps.map((dir) => (dir === "." ? glob : `${dir}/${glob}`));
  }

  // At the project root, `**` would also cover a studio/ or scripts/ beside the app.
  const whole = apps.flatMap((dir) =>
    dir === "." ? ["src/**", "vite.config.ts"] : [`${dir}/**`]
  );

  const restricted = zones(app, whole);

  return {
    // By absolute path: oxlint resolves a relative one from the config that names it.
    jsPlugins: [fileURLToPath(new URL("index.ts", import.meta.url))],
    rules: {
      "visio/restricted-imports": [
        "error",
        { zones: [...restricted, ...more] },
      ],
    },
    overrides: [
      {
        files: app("src/**"),
        plugins: ["jsx-a11y"],
        rules: {
          "jsx-a11y/no-static-element-interactions": "error",
          "jsx-a11y/click-events-have-key-events": "error",
          "jsx-a11y/interactive-supports-focus": "error",
          // It names `<dialog>` for `role="dialog"`, and a modal is a div, as in Base UI
          // and Radix: `<dialog>` brings the top layer. control-element covers button and link.
          "jsx-a11y/prefer-tag-over-role": "off",
          // It reads React's `htmlFor`, not Solid's `<label for>`. Its setting for
          // that is `settings`, which oxlint does not read from an extended config.
          "jsx-a11y/label-has-associated-control": "off",
          // The reset removes the markers of a list with `role="list"` only, and
          // Safari stops announcing a list without markers unless the role is set.
          "jsx-a11y/no-redundant-roles": [
            "error",
            { ul: ["list"], ol: ["list"] },
          ],
          "visio/control-element": "error",
          "visio/no-raw-img": "error",
          "visio/no-inline-svg": "error",
          "visio/no-native-scroll": "error",
          "visio/style-prop-vars": "error",
          "visio/stylesheet-once": "error",
          "visio/no-visio-disable": "error",
          "visio/ref-callback": "error",
          "visio/no-public-meta-env": "error",
          "no-restricted-globals": [
            "error",
            { name: "requestAnimationFrame", message: OWN_LOOP },
            ...["scrollTo", "scrollBy", "scroll"].map((name) => ({
              name,
              message: nativeScroll(name),
            })),
          ],
          "no-restricted-properties": [
            "error",
            {
              object: "window",
              property: "requestAnimationFrame",
              message: OWN_LOOP,
            },
            {
              object: "globalThis",
              property: "requestAnimationFrame",
              message: OWN_LOOP,
            },
          ],
        },
      },
      {
        files: app("src/pages/**"),
        rules: {
          "visio/preload-returns": "error",
          "visio/no-preload-query": "error",
          "visio/meta-return-type": "error",
        },
      },
      {
        files: app("src/server/**"),
        rules: { "visio/server-only-marker": "error" },
      },
      {
        files: app("src/env.ts"),
        rules: { "visio/no-public-secret": "error" },
      },
    ],
  } satisfies OxlintConfig;
}
