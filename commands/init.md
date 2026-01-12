# /init - Initialize Darkroom project standards

Set up a project with Darkroom Engineering conventions.

## Usage
```
/init              # Initialize current project
/init --satus      # Clone from Satus starter
```

## For New Projects (--satus)

```bash
bunx degit darkroomengineering/satus .
bun install
```

## For Existing Projects

1. **Check/create structure**
   ```
   app/
   components/
   lib/
     hooks/
     integrations/
     styles/
     utils/
   ```

2. **Create project CLAUDE.md** (if not exists)
   ```markdown
   # Project: <name>

   ## Overview
   <Brief description>

   ## Key Patterns
   - <Project-specific patterns>

   ## Important Files
   - <Critical files to know about>
   ```

3. **Verify dependencies**
   - TypeScript strict mode
   - Biome for linting
   - Tailwind v4
   - Required Darkroom packages

4. **Create wrappers** (if missing)
   - `components/image/index.tsx`
   - `components/link/index.tsx`

## Output
- List of created/verified files
- Any missing dependencies
- Suggested next steps
