import { defineRoute } from "@visio/router";

import { Prose } from "../components/prose";
import { NAME } from "../lib/product";

export const route = defineRoute("*404", {
  meta: () => ({ title: `Not found · ${NAME}` }),
});

export default function NotFound() {
  return (
    <Prose title="Not found">
      <p>There is no page at this address.</p>
    </Prose>
  );
}
