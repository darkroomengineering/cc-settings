# Ecosystem Contexts

Switchable behavioral contexts for working across different platforms and ecosystems.

## Usage

```bash
/context           # Show available contexts
/context web       # Switch to web development (default)
/context webgl     # Switch to WebGL/3D development
/context desktop   # Switch to desktop apps (Tauri - macOS/Windows/Linux)
/context mobile    # Switch to mobile apps (Expo - iOS/Android)
```

## What Contexts Do

Each context adjusts:

1. **Behavioral Priorities** - What to optimize for (stability, performance, etc.)
2. **Favored Tools** - Which commands and patterns to prefer
3. **Conventions** - Ecosystem-specific patterns and gotchas
4. **Documentation** - Relevant docs sources to reference

## Available Contexts

| Context | Alias | Platform | Primary Stack |
|---------|-------|----------|---------------|
| `web` | `next`, `nextjs` | Web | Next.js, React, Tailwind |
| `webgl` | `3d`, `three` | Web | R3F, Three.js, GSAP |
| `desktop` | `tauri`, `macos`, `mac` | macOS/Windows/Linux | Tauri (Rust + Web) |
| `mobile` | `rn`, `expo`, `ios` | iOS/Android | Expo, React Native |

## When to Switch

- Building a desktop app? `/context desktop`
- Building a mobile app? `/context mobile`
- Working on 3D/WebGL? `/context webgl`
- Back to web work? `/context web`

Contexts persist for the session until you switch again.

## Adding New Contexts

Create a new file `contexts/<name>.md` with:

```markdown
# <Name> Context

Mode: <behavioral description>
Focus: <primary concerns>

## Behavior
- <priority 1>
- <priority 2>

## Priorities
1. <what matters most>
2. <what matters second>

## Tools to Favor
- <preferred tools>

## Gotchas
| Issue | Fix |
|-------|-----|
| <common problem> | <solution> |

## Documentation
- [Link](url) - Description
```
