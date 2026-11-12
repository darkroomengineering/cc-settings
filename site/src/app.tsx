import "@visio/styling/css";
import { css } from "@visio/styling";
import { PageTransitions } from "@visio/transitions";

import { Footer } from "./components/footer";
import { Router } from "./routes";
import { t } from "./styles/tokens";

css.global({
  body: {
    ...t.type.body,
    display: "flex",
    flexDirection: "column",
    color: t.colors.ink,
    backgroundColor: t.colors.page,
  },
  // The outlet's page, so the footer sits at the bottom of a short page.
  main: {
    flexGrow: 1,
  },
});

export default function App() {
  return (
    <Router>
      {() => (
        <>
          <PageTransitions router={Router} />
          <Footer />
        </>
      )}
    </Router>
  );
}
