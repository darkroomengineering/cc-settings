# /hook - Create a custom React hook

Create a new custom hook following Darkroom conventions.

## Usage
```
/hook useScrollPosition
/hook useMediaQuery
```

## Instructions

1. Parse the hook name (must start with `use`)
2. Create at `lib/hooks/<hook-name>.ts`
3. Include proper TypeScript types
4. Add JSDoc documentation

## Template

```tsx
// lib/hooks/<hook-name>.ts
import { useState, useEffect, useCallback } from 'react'

/**
 * <Description of what the hook does>
 *
 * @example
 * ```tsx
 * const value = <hookName>()
 * ```
 */
export function <hookName>() {
  // State
  const [state, setState] = useState<Type>(initialValue)

  // Effects
  useEffect(() => {
    // Setup
    return () => {
      // Cleanup
    }
  }, [])

  // Return value
  return state
}
```

## Notes
- Check `@darkroom.engineering/hamo` first - it may already exist
- Consider performance implications
- Add to barrel export in `lib/hooks/index.ts` if it exists
