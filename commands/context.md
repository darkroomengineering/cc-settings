---
name: context
description: Switch development ecosystem contexts or manage context window
arguments:
  - name: target
    description: Ecosystem (web, ios, macos, tauri, rn) or window action (status, compact, fresh, save)
    required: false
---

**Usage:** `/context [target]`

**Examples:**
- `/context` - Show available contexts and current status
- `/context web` - Switch to web development mode (Next.js, React)
- `/context ios` - Switch to iOS development mode (Swift, SwiftUI)
- `/context macos` - Switch to macOS development mode (AppKit, SwiftUI)
- `/context tauri` - Switch to Tauri desktop app mode (Rust + Web)
- `/context rn` - Switch to React Native mode (Expo)
- `/context status` - Show context window usage
- `/context compact` - Summarize and prune old context

---

## Ecosystem Contexts

### Available Contexts

| Context | Alias | Stack | Profile |
|---------|-------|-------|---------|
| **web** | `nextjs`, `next` | Next.js, React, Tailwind, Lenis | `profiles/nextjs.md` |
| **webgl** | `3d`, `three` | R3F, Three.js, GSAP, WebGL | `profiles/webgl.md` |
| **ios** | `swift`, `swiftui` | Swift, SwiftUI, UIKit | `profiles/ios.md` |
| **macos** | `appkit`, `mac` | Swift, AppKit, SwiftUI | `profiles/macos.md` |
| **tauri** | `desktop` | Rust, Tauri, Web frontend | `profiles/tauri.md` |
| **rn** | `expo`, `mobile` | React Native, Expo | `profiles/react-native.md` |

### Behavior When Switching

```
/context web
```

**Output:**
```markdown
## Context Switched: Web (Next.js)

### Active Profile
`profiles/nextjs.md` loaded

### Behavioral Changes
- **Routing**: App Router patterns (file-based routing)
- **Components**: Server Components by default, 'use client' when needed
- **Styling**: Tailwind CSS v4 + CSS Modules as 's'
- **Images/Links**: Use @/components/ui wrappers
- **Memoization**: React Compiler handles it (no useMemo/useCallback)
- **Smooth Scroll**: Lenis integration available

### Tools Favored
- `bun` for package management
- `biome` for linting/formatting
- `turbopack` for dev bundling

### Key Conventions
- CSS modules imported as `s`
- Image/Link wrappers required
- Server Actions over API routes
- No manual memoization

Session context persisted.
```

---

### Context: iOS (`/context ios`)

**Output:**
```markdown
## Context Switched: iOS (Swift/SwiftUI)

### Behavioral Changes
- **UI Framework**: SwiftUI preferred, UIKit when needed
- **Architecture**: MVVM with ObservableObject
- **Concurrency**: Swift async/await, actors
- **State**: @State, @Binding, @Environment
- **Navigation**: NavigationStack (iOS 16+)

### Tools Favored
- `xcodebuild` for builds
- `swift` CLI for packages
- `xcrun` for simulators

### Key Conventions
- Protocol-oriented design
- Value types (structs) over classes
- Result builders for DSLs
- Combine for reactive streams

Session context persisted.
```

---

### Context: macOS (`/context macos`)

**Output:**
```markdown
## Context Switched: macOS (AppKit/SwiftUI)

### Behavioral Changes
- **UI Framework**: SwiftUI + AppKit interop
- **Windows**: NSWindow, WindowGroup
- **Menus**: @CommandsBuilder, NSMenu
- **System**: NSWorkspace, FileManager
- **Sandboxing**: Entitlements awareness

### Tools Favored
- `xcodebuild` for builds
- `codesign` for signing
- `notarytool` for notarization

### Key Conventions
- Document-based app patterns
- Toolbar and sidebar layouts
- System integration (Services, Spotlight)
- Hardened runtime compliance

Session context persisted.
```

---

### Context: Tauri (`/context tauri`)

**Output:**
```markdown
## Context Switched: Tauri (Rust + Web)

### Active Profile
`profiles/tauri.md` loaded

### Behavioral Changes
- **Backend**: Rust with Tauri commands
- **Frontend**: React/Vue/Svelte web app
- **IPC**: invoke() for Rust calls, events for streaming
- **Security**: Capability-based permissions
- **State**: Managed state with Mutex

### Tools Favored
- `cargo` for Rust backend
- `bun` for frontend
- `bun tauri dev` for development

### Key Conventions
- Commands in src-tauri/src/commands/
- Capabilities in src-tauri/capabilities/
- Error handling with Result types
- Events for progress/streaming

Session context persisted.
```

---

### Context: React Native (`/context rn`)

**Output:**
```markdown
## Context Switched: React Native (Expo)

### Active Profile
`profiles/react-native.md` loaded

### Behavioral Changes
- **Router**: Expo Router (file-based)
- **Styling**: NativeWind (Tailwind) or StyleSheet
- **Lists**: FlashList for performance
- **Animation**: Reanimated + Gesture Handler
- **Platform**: Platform.select() for differences

### Tools Favored
- `expo` CLI
- `eas` for builds
- `npx expo start` for development

### Key Conventions
- SafeAreaView for safe areas
- Platform-specific files (.ios.tsx, .android.tsx)
- Expo modules for native APIs
- React Query for data fetching

Session context persisted.
```

---

## No Argument: Show Available Contexts

```
/context
```

**Output:**
```markdown
## Development Contexts

### Current Context
**web** (Next.js) - Active since session start

### Available Contexts
| Command | Description |
|---------|-------------|
| `/context web` | Next.js, React, Tailwind, Lenis |
| `/context webgl` | R3F, Three.js, GSAP, shaders |
| `/context ios` | Swift, SwiftUI, UIKit |
| `/context macos` | Swift, AppKit, SwiftUI desktop |
| `/context tauri` | Rust + Web desktop apps |
| `/context rn` | React Native with Expo |

### Context Window
Usage: ████████░░ 73% (~73,000 / 100,000 tokens)

Use `/context status` for detailed window info.
Use `/context compact` to free up space.
```

---

## Context Window Management

These actions manage the conversation context window:

### `/context status`
```markdown
## Context Window Status

Usage: ████████░░ 73% (~73,000 / 100,000 tokens)

### Breakdown
- Conversation: 45%
- Tool outputs: 20%
- File contents: 8%

### Recommendations
[Based on usage level]
```

### `/context compact`
```
1. Summarize old conversation turns
2. Prune stale file contents
3. Collapse resolved discussions
4. Remove redundant tool outputs
5. Report space recovered
```

Output:
```markdown
## Context Compacted

Recovered: ~15,000 tokens (15%)
New usage: ██████░░░░ 58%

### Actions Taken
- Summarized 12 conversation turns
- Pruned 5 stale file reads
- Collapsed 3 resolved threads
```

### `/context fresh`
```
1. Create summary of current session
2. Note important context to preserve
3. List active todos
4. Start new context
5. Inject summary
```

### `/context save`
```
1. Capture current state
2. Save todos and progress
3. Note conversation summary
4. Store for recovery
```

---

## Session Persistence

When you switch contexts:

1. **Profile Loaded**: Relevant `profiles/*.md` file is loaded
2. **Behavioral Shift**: Assistant prioritizes ecosystem-specific patterns
3. **Tools Adjusted**: Preferred CLI tools and build systems change
4. **Conventions Applied**: Coding standards shift to ecosystem norms
5. **Session Persists**: Context remains active until explicitly changed

The ecosystem context persists for the entire session. To switch back:
```
/context web
```

---

## Auto-Detection

If no context is set, auto-detection runs based on project files:

| File Detected | Context Set |
|---------------|-------------|
| `next.config.*` | web |
| `@react-three/fiber` in deps | webgl |
| `*.xcodeproj` or `Package.swift` | ios/macos |
| `tauri.conf.json` | tauri |
| `expo` in deps or `app.json` with expo | rn |

---

**Related Commands:**
- `/create-handoff` - Full session handoff (at 80%+ usage)
- `/resume-handoff` - Resume from previous handoff
- `/explore` - Navigate codebase in current context
