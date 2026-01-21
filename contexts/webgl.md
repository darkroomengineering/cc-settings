# WebGL/3D Context

> Context for 3D web applications with React Three Fiber, GSAP, Three.js, and Lenis smooth scroll.

---

## Behavioral Mode

**Performance-obsessed, frame-rate-aware, GPU-conscious.**

- Frame budget is sacred: 16.67ms per frame for 60fps
- Dispose geometries, materials, textures on unmount
- Use instancing for repeated objects
- Dynamic import GSAP (no SSR)
- Lenis for scroll-driven 3D animations

---

## Priorities (Ordered)

1. **Frame Rate** - Is it hitting 60fps? No jank?
2. **Memory** - Are resources disposed? No leaks?
3. **Correctness** - Does the visual match intent?
4. **Performance** - Draw calls minimized? Instancing used?
5. **Responsiveness** - Does it adapt to device capabilities?

---

## Favored Tools & Commands

| Task | Command/Tool |
|------|--------------|
| Package manager | `bun` (never npm/yarn) |
| Dev server | `bun dev` |
| Performance monitor | `r3f-perf` component |
| Fetch docs | `/docs three`, `/docs gsap`, `/docs lenis` |
| Visual QA | `/qa` or `agent-browser` |
| Linting/formatting | `bun biome check --fix` |

---

## Required Patterns

### R3F Canvas Setup
```tsx
import { Canvas } from '@react-three/fiber'

<Canvas
  camera={{ position: [0, 0, 5], fov: 50 }}
  dpr={[1, 2]}
  gl={{ antialias: true, alpha: true }}
>
  <Scene />
</Canvas>
```

### GSAP Dynamic Import
```tsx
// Never import GSAP at module level in Next.js
import dynamic from 'next/dynamic'
const GSAPScene = dynamic(() => import('./GSAPScene'), { ssr: false })
```

### useGSAP Hook (Not useEffect)
```tsx
import { useGSAP } from '@gsap/react'

useGSAP(() => {
  gsap.to('.element', { x: 100 })
}, { scope: containerRef })
```

### Lenis + ScrollTrigger
```tsx
const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
```

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| GSAP hydration errors | Dynamic import with `{ ssr: false }` |
| Memory leaks in Three.js | Dispose geometry/material in cleanup |
| Scroll jank with ScrollTrigger | Integrate Lenis properly |
| Low FPS on mobile | Reduce `dpr`, simplify geometry |
| Texture size issues | Use power-of-2 dimensions (512, 1024, 2048) |
| Too many draw calls | Use instancing via `<Instances>` |
| `useMemo` in R3F | Not needed - React Compiler handles it |
| Missing cleanup | Always return cleanup in `useEffect`/`useGSAP` |

---

## Performance Budgets

| Metric | Target |
|--------|--------|
| Frame time | < 16.67ms (60fps) |
| JS budget per frame | < 10ms |
| Low-poly geometry | < 10,000 triangles |
| Medium geometry | 10,000-50,000 triangles |
| High geometry | 50,000-200,000 triangles |

---

## Documentation Sources

- **React Three Fiber**: `/docs react-three-fiber` or [docs.pmnd.rs/react-three-fiber](https://docs.pmnd.rs/react-three-fiber)
- **Three.js**: `/docs three`
- **GSAP**: `/docs gsap`
- **Lenis**: `/docs lenis`
- **@react-three/drei**: `/docs drei`

---

## Pre-Implementation Checklist

- [ ] Fetched latest docs for R3F, GSAP, Lenis
- [ ] GSAP dynamically imported (no SSR)
- [ ] Cleanup functions dispose resources
- [ ] Performance monitoring in dev mode
- [ ] Responsive DPR and geometry quality
- [ ] Instancing for repeated objects
