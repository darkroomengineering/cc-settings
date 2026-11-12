import { catchAll, defineRoutes, page } from "@visio/router";

export const routes = defineRoutes([
  page("/", () => import("./pages/home")),
  page("/privacy", () => import("./pages/privacy")),
  page("/support", () => import("./pages/support")),
  catchAll(() => import("./pages/not-found")),
]);

export const { Router, paths } = routes;
