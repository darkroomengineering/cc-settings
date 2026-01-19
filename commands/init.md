# /init - Initialize Darkroom Project

**Default: Use Satus starter.** Only use existing project mode for legacy codebases.

## Usage
```
/init              # Clone Satus starter (DEFAULT)
/init --existing   # Configure existing project
```

## New Projects (Default)

**Always start with Satus:**

```bash
bunx degit darkroomengineering/satus my-project
cd my-project
bun install
bun dev
```

**Why Satus?**
- Pre-configured React Compiler (no manual memoization needed)
- Correct dependency versions (tested, compatible)
- Darkroom conventions built-in (Image/Link wrappers, CSS modules)
- Lenis, GSAP, R3F, Sanity integrations ready
- Biome, TypeScript strict mode, Tailwind v4

## Existing Projects (--existing)

For legacy codebases that can't use Satus:

1. **Verify structure**
   ```
   app/
   components/
   lib/
     hooks/
     integrations/
     styles/
     utils/
   ```

2. **Create project CLAUDE.md**
   ```markdown
   # Project: <name>

   ## Overview
   <Brief description>

   ## Key Patterns
   - <Project-specific conventions>

   ## Important Files
   - <Critical files to know about>
   ```

3. **Check dependencies are latest**
   ```bash
   # ALWAYS check before installing
   bun info <package>

   # Fetch current docs
   /docs <library>
   ```

4. **Create wrappers** (if missing)
   - `components/ui/image/index.tsx`
   - `components/ui/link/index.tsx`

## Pre-Implementation Checklist

Before writing ANY code with external libraries:

- [ ] **Fetch latest docs**: `/docs <library>` (context7)
- [ ] **Check latest version**: `bun info <package>`
- [ ] **Use Satus conventions** if applicable

## Output
- Created/cloned project structure
- Installed dependencies with correct versions
- Ready to run `bun dev`
