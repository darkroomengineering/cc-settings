# /component - Create a Darkroom component

Create a new React component following Darkroom conventions.

## Usage
```
/component Button
/component Header --client
```

## Instructions

1. Parse the component name from arguments
2. Determine if it needs `'use client'` directive
3. Create the component folder structure:
   - `components/<name>/index.tsx`
   - `components/<name>/<name>.module.css`
4. Use the scaffolder agent or create directly

## Template

```tsx
// components/<name>/index.tsx
'use client' // Only if --client flag or needs interactivity

import s from './<name>.module.css'

interface <Name>Props {
  children?: React.ReactNode
  className?: string
}

export function <Name>({ children, className }: <Name>Props) {
  return (
    <div className={`${s.<name>} ${className ?? ''}`}>
      {children}
    </div>
  )
}
```

```css
/* components/<name>/<name>.module.css */
.<name> {
  /* Component styles */
}
```
