# /versions - Check npm package versions

Check the latest version of any npm package. Run without args to see common Darkroom stack versions as examples.

## Usage
```
/versions           # Show common Darkroom stack versions (examples)
/versions <package> # Check any npm package version
```

## Arguments

| Argument | Description |
|----------|-------------|
| (none) | Show common stack versions as examples |
| `<package>` | Check any npm package version |

## The Principle

Before installing ANY library, always:
1. Check latest version: `bun info <package>`
2. Fetch current docs: `/docs <library>` (context7)

This ensures you're using valid, up-to-date APIs and leveraging the latest features.

## Behavior

### Check specific package
```bash
bun info <package> --json | jq -r '"<package>: " + .version'
```

### Show common stack (no args - examples only)
```bash
echo "Common Darkroom stack versions:"
echo "(Use '/versions <package>' to check any package)"
echo ""

echo "=== Core Stack ==="
bun info next --json | jq -r '"next: " + .version'
bun info react --json | jq -r '"react: " + .version'
bun info typescript --json | jq -r '"typescript: " + .version'

echo "\n=== Darkroom Packages ==="
bun info lenis --json | jq -r '"lenis: " + .version'
bun info hamo --json | jq -r '"hamo: " + .version'
bun info tempus --json | jq -r '"tempus: " + .version'

echo "\n=== Common Dependencies ==="
bun info gsap --json | jq -r '"gsap: " + .version'
bun info tailwindcss --json | jq -r '"tailwindcss: " + .version'
```

## Example Output

```
Common Darkroom stack versions:
(Use '/versions <package>' to check any package)

=== Core Stack ===
next: 15.1.0
react: 19.0.0
typescript: 5.7.2

=== Darkroom Packages ===
lenis: 1.1.18
hamo: 0.6.4
tempus: 0.0.51

=== Common Dependencies ===
gsap: 3.12.5
tailwindcss: 4.0.0

To install latest versions:
  bun add <package>@latest
```

## Package Migration Notes

The following packages have been renamed:
- `@darkroom.engineering/hamo` -> `hamo`
- `@darkroom.engineering/tempus` -> `tempus`

For existing projects using legacy names, both packages are still available. New projects should use the short names.

## Notes

- Uses `bun info` to fetch latest published version from npm registry
- Works with ANY npm package, not just Darkroom stack
- Requires `jq` for JSON parsing (pre-installed on most systems)
- For production, consider pinning to specific versions after checking
- Fetch docs with `/docs <library>` to ensure you're using current APIs
