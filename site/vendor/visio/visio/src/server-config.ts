// The configure module `visio()` hands the Solid plugin. With the router as
// the single-flight collector, an action's response carries the refreshed
// query() data for the page the client shows, and the router seeds its cache
// from it instead of fetching again.
import { createFlightDataCollector } from "@solidjs/router/server";
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { Router } from "virtual:visio/router";

configureServerFunctionsServer({
  collectFlightData: createFlightDataCollector(Router),
});
