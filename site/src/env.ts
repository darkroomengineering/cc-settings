import { defineEnv } from "@visio/env";
import * as v from "valibot";

export const env = defineEnv({
  client: {
    // The public origin. Set it to get canonical URLs and a sitemap.
    PUBLIC_SITE_URL: v.optional(v.pipe(v.string(), v.url())),
    // `true` lets search engines index this deployment: a sitemap, and no
    // noindex on every page. Leave it unset on previews. visio() reads it.
    PUBLIC_SITE_INDEXABLE: v.optional(v.picklist(["true", "false"])),
  },
});
