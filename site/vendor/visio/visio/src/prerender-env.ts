import type { Plugin } from "vite";

const PACKAGE_DIST = /[\\/]@solidjs[\\/]prerender[\\/]dist[\\/][^\\/]+\.m?js$/u;

const POSTURE_READ = "const env = import.meta.env;";

const MEMBER_READS =
  "const env = { PRERENDER_MODE: import.meta.env.PRERENDER_MODE, BASE_URL: import.meta.env.BASE_URL, PRERENDER_BUILD: import.meta.env.PRERENDER_BUILD };";

const WHOLE_READ = /import\.meta\.env(?!\s*\??\.)/u;

export function prerenderEnv(): Plugin {
  return {
    name: "visio:prerender-env",
    apply: "build",
    applyToEnvironment: (environment) =>
      environment.config.consumer === "client",
    transform: {
      filter: { id: PACKAGE_DIST, code: "import.meta.env" },
      handler(code, id) {
        const rewritten = code.replaceAll(POSTURE_READ, MEMBER_READS);

        if (WHOLE_READ.test(rewritten)) {
          this.error(
            `[visio] ${id} reads import.meta.env as a whole object, in a form visio does not rewrite. Vite would inline every env value into a client chunk, MODE "production" included, and the Solid plugin's leak scan would stop the build on any server env value equal to one of them. Report it to visio, with the @solidjs/prerender version, and pin @solidjs/prerender to the last version that built.`
          );
        }

        return rewritten === code ? undefined : { code: rewritten, map: null };
      },
    },
  };
}
