declare module "virtual:visio/middleware" {
  const chain: readonly unknown[];
  export default chain;
}

declare module "virtual:visio/router" {
  export const Router: Parameters<
    typeof import("@solidjs/router/server").createFlightDataCollector
  >[0];
}
