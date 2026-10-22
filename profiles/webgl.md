---
name: webgl
description: 3D web (R3F, Three.js, GSAP)
---

# WebGL/3D Profile (R3F, GSAP, Lenis)

> Darkroom conventions for 3D web with React Three Fiber, GSAP, Lenis, and Tempus. Priorities in order: frame rate (60fps, no jank), memory (resources disposed), correctness, draw calls, responsiveness to device capability.

## Stack Conventions

- Dispose geometries, materials, and textures on unmount; use `<Instances>` for repeated objects.
- Dynamic import GSAP with `{ ssr: false }` (hydration errors otherwise); give every `useGSAP` a `scope`.
- Use `useFrame` delta for frame-independent animation; use `useTempus` for non-R3F per-frame work.
- Perf monitor: `r3f-perf` `<Perf />`, rendered only when `process.env.NODE_ENV === 'development'`.
- Fetch current R3F, drei, three, gsap, and lenis APIs through Context7 before using them.

### GPU Resource Ownership

When a hook owns a GPU resource (a fluid or flowmap sim, an FBO or render target, a renderer), the mount effect is its sole owner: create it in the effect, `.destroy()` it in the cleanup. Creating it in a `useState` initializer leaks: the initializer's instance is orphaned when the mount effect builds a second one, and GPU memory creeps up across route navigations. Keep one root `<Canvas>` and portal content into it (tunnel-rat); a non-root canvas mounts nothing and falls back to the root via `useCanvas()`. Cache session-constant device probes (Safari, WebGL, autoplay) at module level; the autoplay check spins up a `<video>` per call.

### Reject Software Renderers in the Mount Gate

GPU-less runners (PageSpeed Insights, cloud Lighthouse, default headless Chromium) run WebGL through SwiftShader on the CPU. A shader that renders every frame pegs the main thread and Lighthouse reports `PAGE_HUNG`. Every WebGL mount gate rejects software renderers, not just missing WebGL2: read the renderer string (`WEBGL_debug_renderer_info` then `UNMASKED_RENDERER_WEBGL`, or `gl.RENDERER` on Chrome 101+), bail to the CSS or static fallback when it matches `/swiftshader|llvmpipe|softpipe|software/i`, and release the probe context with `WEBGL_lose_context` so it does not count against the ~16 live-context cap. satus applies this in `useDeviceDetection().isWebGL`; anything mounting outside the starter's root canvas calls the gate itself. Reproduce locally with `lighthouse <url> --chrome-flags='--headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader'`.

---

## Lenis + Tempus + GSAP Ordering

Tempus runs one global RAF. `order` sorts callbacks within a frame: lower runs first, default 0. Lenis runs first (`order: -1`); anything that reads `lenis.scroll` to draw runs after it with an explicit order (canvas 1, followers 2):

```tsx
const remove = Tempus.add(({ time }) => lenis.raf(time), { order: -1, label: 'lenis' })
```

Give every Tempus callback an explicit `order` and keep the list in one comment next to the Lenis setup. A reader that runs before Lenis makes the canvas lag the DOM by one frame of scroll on every wheel flick.

With GSAP ScrollTrigger:

```tsx
lenis.on('scroll', ScrollTrigger.update)
const tick = (time: number) => lenis.raf(time * 1000)
gsap.ticker.add(tick)
gsap.ticker.lagSmoothing(0)
// cleanup: gsap.ticker.remove(tick); lenis.destroy()
```

---

## Performance Budgets

- 60fps = 16.67ms per frame; keep JS under ~10ms to leave room for rendering.
- Triangles: low-poly < 10,000; medium 10,000-50,000; high 50,000-200,000; hero asset 200,000+.
- Textures: power-of-2 dimensions (512, 1024, 2048), KTX2/Basis compression through `@react-three/drei` loaders.
- Mobile: drop `dpr` to 1 and lower geometry quality.

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| Scroll jank with ScrollTrigger | Integrate Lenis (`lenis.on('scroll', ScrollTrigger.update)`) |
| GPU memory creeps across routes | Create GPU resources in the mount effect, never a `useState` initializer |
| Lighthouse `PAGE_HUNG`, PSI never finishes | Mount gate rejects software renderers (SwiftShader) |
| Canvas slides against DOM content while scrolling | Lenis at Tempus order -1; scroll readers after it with explicit orders |
| WebGL size or position drifts from the design | Follow a DOM box placed by CSS: `useWebGLElement` on the DOM side, `useWebGLRect` in the canvas; never a design constant times section width |
| Canvas-side `useRect` stays `undefined` | No hamo `useRect` / `useResizeObserver` / `useIntersectionObserver` inside `WebGLTunnel` children; measure on the DOM side and pass `rect` as a prop |
| Pinned WebGL element shakes by 1px | Values that must cancel use the same scroll, rounding, and event; hamo scroll-trigger progress floors, `useWebGLRect` rounds |

---

## Pre-Implementation Checklist

- [ ] Cleanup functions dispose resources
- [ ] Responsive DPR and geometry quality
- [ ] Every `useTempus` has an explicit `order`; scroll readers run after Lenis (-1)
- [ ] Every WebGL element follows a DOM box
