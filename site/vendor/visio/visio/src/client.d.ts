/**
 * What `visio()` defines for the app. Add `visio/client` to the `types` of
 * the app's tsconfig.
 */
interface ImportMetaEnv {
  /** `PUBLIC_SITE_URL` from the env, or an empty string. */
  readonly SITE_URL: string;
  /** True when the env sets `PUBLIC_SITE_INDEXABLE=true`, except in a preview build on Workers Builds. */
  readonly SITE_INDEXABLE: boolean;
  /** `site.name` from the Vite config, or an empty string. */
  readonly SITE_NAME: string;
  /** `site.locale` from the Vite config, or an empty string. */
  readonly SITE_LOCALE: string;
  /** `site.image` from the Vite config, or null. */
  readonly SITE_IMAGE: NonNullable<
    import("./index.ts").SiteOptions["image"]
  > | null;
}
