---
name: auto-format
trigger: post-edit
description: Automatically formats files after editing using Biome
enabled: true
filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css"]
---

**Purpose:** Maintain consistent code formatting across the project.

**Behavior:**

```
ON post_edit:
  IF file_matches_pattern:
    RUN biome format --write on_file
    LOG formatting_applied
```

**Commands:**

```bash
# Format single file
bun biome format --write path/to/file.ts

# Format directory
bun biome format --write src/

# Check without writing
bun biome format --check path/to/file.ts
```

**Formatting Rules (Biome Defaults):**

- **Indentation:** 2 spaces (configurable)
- **Quotes:** Double quotes for JSX, configurable for JS/TS
- **Semicolons:** As configured in biome.json
- **Trailing commas:** ES5 compatible
- **Line width:** 80 characters (configurable)

**Output:**

```markdown
✓ Formatted `src/component.tsx`

## Changes Applied
- Normalized indentation
- Added missing semicolons
- Adjusted line breaks
```

**Configuration:**

Located in `biome.json`:
```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 80
  }
}
```

**Note:** This hook runs silently in most cases. It only reports when significant formatting changes are made.
