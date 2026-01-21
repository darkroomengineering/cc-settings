---
name: context
description: Switch development ecosystem contexts or manage context window
arguments:
  - name: target
    description: Ecosystem (web, webgl, desktop, mobile) or window action (status, compact, fresh, save)
    required: false
---

**Usage:** `/context [target]`

**Examples:**
- `/context` - Show available contexts and current status
- `/context web` - Switch to web development mode (Next.js, React)
- `/context webgl` - Switch to WebGL/3D mode (R3F, Three.js)
- `/context desktop` - Switch to desktop app mode (Tauri - macOS/Windows/Linux)
- `/context mobile` - Switch to mobile app mode (Expo - iOS/Android)
- `/context status` - Show context window usage
- `/context compact` - Summarize and prune old context

---

## Ecosystem Contexts

### Available Contexts

| Context | Alias | Stack | Profile |
|---------|-------|-------|---------|
| **web** | `nextjs`, `next` | Next.js, React, Tailwind, Lenis | `profiles/nextjs.md` |
| **webgl** | `3d`, `three` | R3F, Three.js, GSAP, WebGL | `profiles/webgl.md` |
| **desktop** | `tauri`, `macos`, `mac` | Tauri (Rust + Web) for macOS/Windows/Linux | `profiles/tauri.md` |
| **mobile** | `rn`, `expo`, `ios` | Expo/React Native for iOS/Android | `profiles/react-native.md` |

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

### Context: Desktop (`/context desktop`)

**Output:**
```markdown
## Context Switched: Desktop (Tauri)

**Target Platforms**: macOS, Windows, Linux

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

### Context: Mobile (`/context mobile`)

**Output:**
```markdown
## Context Switched: Mobile (Expo)

**Target Platforms**: iOS, Android

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
| `/context desktop` | Tauri for macOS/Windows/Linux |
| `/context mobile` | Expo for iOS/Android |

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
| `tauri.conf.json` or `src-tauri/` | desktop |
| `expo` in deps or `app.json` with expo | mobile |

---

**Related Commands:**
- `/create-handoff` - Full session handoff (at 80%+ usage)
- `/resume-handoff` - Resume from previous handoff
- `/explore` - Navigate codebase in current context
