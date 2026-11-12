import { controlElement } from "./rules/control-element.ts";
import { metaReturnType } from "./rules/meta-return-type.ts";
import { noInlineSvg } from "./rules/no-inline-svg.ts";
import { noNativeScroll } from "./rules/no-native-scroll.ts";
import { noPreloadQuery } from "./rules/no-preload-query.ts";
import { noPublicMetaEnv } from "./rules/no-public-meta-env.ts";
import { noPublicSecret } from "./rules/no-public-secret.ts";
import { noRawImg } from "./rules/no-raw-img.ts";
import { noVisioDisable } from "./rules/no-visio-disable.ts";
import { preloadReturns } from "./rules/preload-returns.ts";
import { refCallback } from "./rules/ref-callback.ts";
import { restrictedImports } from "./rules/restricted-imports.ts";
import { serverOnlyMarker } from "./rules/server-only-marker.ts";
import { stylePropVars } from "./rules/style-prop-vars.ts";
import { stylesheetOnce } from "./rules/stylesheet-once.ts";
import type { Plugin } from "./types.ts";

const plugin: Plugin = {
  meta: { name: "visio" },
  rules: {
    "control-element": controlElement,
    "meta-return-type": metaReturnType,
    "no-inline-svg": noInlineSvg,
    "no-native-scroll": noNativeScroll,
    "no-preload-query": noPreloadQuery,
    "no-public-meta-env": noPublicMetaEnv,
    "no-public-secret": noPublicSecret,
    "no-raw-img": noRawImg,
    "no-visio-disable": noVisioDisable,
    "preload-returns": preloadReturns,
    "ref-callback": refCallback,
    "restricted-imports": restrictedImports,
    "server-only-marker": serverOnlyMarker,
    "style-prop-vars": stylePropVars,
    "stylesheet-once": stylesheetOnce,
  },
};

export default plugin;
