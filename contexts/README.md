# Ecosystem Contexts

Switchable behavioral contexts for working across different platforms and ecosystems.

## Usage

```bash
/context           # Show available contexts
/context web       # Switch to web development (default)
/context ios       # Switch to iOS/Swift development
/context macos     # Switch to macOS native development
/context tauri     # Switch to Tauri desktop apps
/context rn        # Switch to React Native/Expo
```

## What Contexts Do

Each context adjusts:

1. **Behavioral Priorities** - What to optimize for (stability, performance, etc.)
2. **Favored Tools** - Which commands and patterns to prefer
3. **Conventions** - Ecosystem-specific patterns and gotchas
4. **Documentation** - Relevant docs sources to reference

## Available Contexts

| Context | Ecosystem | Primary Stack |
|---------|-----------|---------------|
| `web` | Web development | Next.js, React, Tailwind |
| `ios` | iOS apps | Swift, SwiftUI, XCTest |
| `macos` | macOS apps | AppKit, SwiftUI, Sandbox |
| `tauri` | Desktop apps | Rust, Web frontend, IPC |
| `rn` | Mobile apps | React Native, Expo |

## When to Switch

- Working on an iOS feature? `/context ios`
- Building a Tauri app? `/context tauri`
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
