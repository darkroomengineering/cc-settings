import type Lenis from "lenis";
import { createSignal } from "solid-js";

/**
 * The page's Lenis instance: undefined on the server, without
 * `SmoothScroll`, and after it unmounts. For reading `scroll`, `velocity`
 * or `progress` inside a frame callback; scroll with `scrollTo()` and
 * `lockScroll()`, which work without it too.
 */
const [lenis, setLenis] = createSignal<Lenis>();

export { lenis, setLenis };
