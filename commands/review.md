# /review - Code review current changes

Review staged or unstaged changes against Darkroom standards.

## Usage
```
/review          # Review all changes
/review staged   # Review only staged changes
/review <file>   # Review specific file
```

## Instructions

1. Get the changes to review:
   - `git diff` for unstaged
   - `git diff --staged` for staged
   - Read file directly if path provided

2. Use the reviewer agent or check manually:
   - TypeScript strictness (no `any`)
   - React patterns (Server/Client components)
   - Styling conventions (Tailwind, CSS Modules)
   - Performance (Hamo hooks, Lenis, Tempus)
   - Architecture (correct file placement)

3. Output structured review with:
   - Summary
   - Critical issues
   - Warnings
   - Suggestions
   - Approval status

## Checklist

- [ ] No `any` types
- [ ] Server Components by default
- [ ] Custom Image/Link wrappers used
- [ ] CSS Modules imported as `s`
- [ ] No inline styles
- [ ] Proper file structure
- [ ] No secrets/env values
