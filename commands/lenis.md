# /lenis - Set up Lenis smooth scroll

Add Lenis smooth scroll to a Next.js project.

## Usage
```
/lenis           # Full setup with React integration
/lenis vanilla   # Vanilla JS only
```

## Instructions

1. **Check latest version and install**
   ```bash
   # Check latest version
   bun info lenis --json | jq -r '"lenis@" + .version'

   # Install with explicit latest
   bun add lenis@latest
   ```

   > Using `@latest` ensures the most recent version. For production stability, pin to a specific version after checking.

2. **Create Lenis provider** (React)
   ```tsx
   // components/lenis/index.tsx
   'use client'

   import { ReactLenis } from 'lenis/react'

   interface LenisProviderProps {
     children: React.ReactNode
   }

   export function LenisProvider({ children }: LenisProviderProps) {
     return (
       <ReactLenis
         root
         options={{
           duration: 1.2,
           easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
           orientation: 'vertical',
           gestureOrientation: 'vertical',
           smoothWheel: true,
         }}
       >
         {children}
       </ReactLenis>
     )
   }
   ```

3. **Add to layout**
   ```tsx
   // app/layout.tsx
   import { LenisProvider } from '@/components/lenis'

   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           <LenisProvider>{children}</LenisProvider>
         </body>
       </html>
     )
   }
   ```

4. **Usage in components**
   ```tsx
   import { useLenis } from 'lenis/react'

   function Component() {
     const lenis = useLenis()

     const scrollToTop = () => {
       lenis?.scrollTo(0)
     }
   }
   ```

## Notes
- Lenis replaces native scroll - some CSS scroll behaviors won't work
- Use `data-lenis-prevent` to disable on specific elements
- For GSAP integration, see Lenis docs
