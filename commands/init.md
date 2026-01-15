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

5. **Always check latest versions and documentation**

   Before installing ANY dependency:
   ```bash
   # Check latest version
   bun info <package> --json | jq '.version'

   # Or install with explicit latest
   bun add <package>@latest
   ```

   **Fetch current documentation** to ensure valid API usage:
   ```
   /docs <library>
   ```

   > This applies to ALL libraries - Next.js, React, TypeScript, animation libraries, CMS integrations, etc. APIs change between versions. Always reference current docs.

6. **Package migration note**
   `hamo` and `tempus` were previously `@darkroom.engineering/hamo` and `@darkroom.engineering/tempus`. Use the new short names for new projects.

7. **Recommended: Use Satus for turnkey setup**
   The Satus template includes pinned, tested versions. Prefer `--satus` flag when possible.

## Output
- List of created/verified files
- Any missing dependencies
- Suggested next steps
