# WebGL/3D Profile (R3F, GSAP, Lenis)

> Patterns for 3D web applications with React Three Fiber, GSAP animations, and Lenis smooth scroll.

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

## React Three Fiber (R3F)

### Basic Setup
```tsx
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'

function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 50 }}
      dpr={[1, 2]} // Device pixel ratio range
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} />
      <MyMesh />
      <OrbitControls />
      <Environment preset="city" />
    </Canvas>
  )
}
```

### useFrame for Animation
```tsx
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

function RotatingBox() {
  const meshRef = useRef<Mesh>(null)

  useFrame((state, delta) => {
    if (!meshRef.current) return
    meshRef.current.rotation.x += delta
    meshRef.current.rotation.y += delta * 0.5
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  )
}
```

### Performance: Instancing
```tsx
import { Instances, Instance } from '@react-three/drei'

function ManyBoxes({ count = 1000 }) {
  const positions = useMemo(() =>
    Array.from({ length: count }, () => [
      Math.random() * 10 - 5,
      Math.random() * 10 - 5,
      Math.random() * 10 - 5
    ] as [number, number, number]),
    [count]
  )

  return (
    <Instances limit={count}>
      <boxGeometry />
      <meshStandardMaterial />
      {positions.map((pos, i) => (
        <Instance key={i} position={pos} />
      ))}
    </Instances>
  )
}
```

### Cleanup on Unmount
```tsx
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

function SceneWithCleanup() {
  const { gl, scene } = useThree()

  useEffect(() => {
    return () => {
      // Dispose geometries and materials
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry?.dispose()
          if (Array.isArray(object.material)) {
            object.material.forEach(m => m.dispose())
          } else {
            object.material?.dispose()
          }
        }
      })
    }
  }, [scene])

  return <MyScene />
}
```

---

## GSAP Animation

### Dynamic Import (No SSR)
```tsx
import dynamic from 'next/dynamic'

const GSAPScene = dynamic(() => import('./GSAPScene'), { ssr: false })

// GSAPScene.tsx
'use client'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

export default function GSAPScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.to('.box', {
      x: 100,
      rotation: 360,
      duration: 2,
      scrollTrigger: {
        trigger: containerRef.current,
        start: 'top center',
        end: 'bottom center',
        scrub: true
      }
    })
  }, { scope: containerRef })

  return (
    <div ref={containerRef}>
      <div className="box">Animated</div>
    </div>
  )
}
```

### gsap.context() for Cleanup
```tsx
useEffect(() => {
  const ctx = gsap.context(() => {
    gsap.to('.element', { x: 100 })
    gsap.to('.other', { y: 50 })
  }, containerRef)

  return () => ctx.revert() // Cleanup all animations
}, [])
```

### Timeline for Sequences
```tsx
useGSAP(() => {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.section',
      start: 'top top',
      end: '+=2000',
      scrub: 1,
      pin: true
    }
  })

  tl.to('.title', { y: -100, opacity: 0 })
    .to('.content', { y: 0, opacity: 1 }, '-=0.5')
    .to('.cta', { scale: 1.2 })
}, { scope: containerRef })
```

---

## Lenis Smooth Scroll

### App-Level Setup
```tsx
// app/layout.tsx
import { ReactLenis } from 'lenis/react'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ReactLenis root options={{ lerp: 0.1, duration: 1.2 }}>
          {children}
        </ReactLenis>
      </body>
    </html>
  )
}
```

### Vanilla JS Setup
```tsx
'use client'
import { useEffect } from 'react'
import Lenis from 'lenis'

export function SmoothScrollProvider({ children }) {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      smoothWheel: true,
    })

    function raf(time: number) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)

    return () => lenis.destroy()
  }, [])

  return children
}
```

### Lenis + GSAP ScrollTrigger
```tsx
useEffect(() => {
  const lenis = new Lenis()

  lenis.on('scroll', ScrollTrigger.update)

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
  })

  gsap.ticker.lagSmoothing(0)

  return () => {
    lenis.destroy()
    gsap.ticker.remove(lenis.raf)
  }
}, [])
```

### Scroll To
```tsx
import { useLenis } from 'lenis/react'

function ScrollToTop() {
  const lenis = useLenis()

  return (
    <button onClick={() => lenis?.scrollTo(0)}>
      Back to Top
    </button>
  )
}

// Scroll to element
lenis?.scrollTo('#section', { offset: -100 })

// Scroll with callback
lenis?.scrollTo(target, {
  onComplete: () => console.log('Scrolled!')
})
```

---

## Tempus (RAF Management)

```tsx
import Tempus from 'tempus'

// Single global RAF
const tempus = new Tempus()

function Component() {
  useEffect(() => {
    const unsubscribe = tempus.add((time, delta) => {
      // Animation logic
      mesh.rotation.x += delta * 0.001
    }, 0) // Priority 0 (higher = runs first)

    return unsubscribe
  }, [])
}
```

---

## Performance Budgets

### Frame Budget
- **Target**: 60fps = 16.67ms per frame
- **Safe budget**: ~10ms for JS (leave room for rendering)
- Use `useFrame` delta for frame-independent animation

### Geometry Guidelines
| Complexity | Triangle Count |
|------------|----------------|
| Low-poly   | < 10,000      |
| Medium     | 10,000-50,000 |
| High       | 50,000-200,000 |
| Hero asset | 200,000+      |

### Texture Guidelines
- Power of 2 dimensions (512, 1024, 2048)
- Compress with KTX2/Basis for GPU textures
- Use `@react-three/drei` loaders with compression

### Performance Monitoring
```tsx
import { Perf } from 'r3f-perf'

<Canvas>
  {process.env.NODE_ENV === 'development' && <Perf position="top-left" />}
  <Scene />
</Canvas>
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

## Common Patterns

### Scroll-Driven 3D
```tsx
function ScrollScene() {
  const meshRef = useRef<Mesh>(null)

  useLenis(({ scroll, limit }) => {
    if (!meshRef.current) return
    const progress = scroll / limit
    meshRef.current.rotation.y = progress * Math.PI * 2
    meshRef.current.position.y = -progress * 5
  })

  return <mesh ref={meshRef}>...</mesh>
}
```

### Responsive Canvas
```tsx
function ResponsiveCanvas() {
  const isMobile = useMediaQuery('(max-width: 768px)')

  return (
    <Canvas
      dpr={isMobile ? 1 : [1, 2]}
      camera={{ fov: isMobile ? 60 : 50 }}
    >
      <Scene quality={isMobile ? 'low' : 'high'} />
    </Canvas>
  )
}
```

### Loading States
```tsx
import { Suspense } from 'react'
import { useProgress, Html } from '@react-three/drei'

function Loader() {
  const { progress } = useProgress()
  return <Html center>{progress.toFixed(0)}%</Html>
}

<Canvas>
  <Suspense fallback={<Loader />}>
    <HeavyModel />
  </Suspense>
</Canvas>
```

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
