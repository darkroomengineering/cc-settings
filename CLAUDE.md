# Darkroom Engineering - Claude Code Configuration

> Team-shareable AI coding standards for darkroom.engineering projects

---

## ⛔ STOP - MANDATORY FIRST ACTION

**Before doing ANYTHING, you MUST delegate.** This is not optional.

### Default Operating Mode: MAESTRO

You are running in **Maestro orchestration mode**. Your job is to **coordinate agents**, not execute directly.

### IMMEDIATE ACTION REQUIRED

For EVERY user request, your FIRST response MUST be one of:

```
1. SPAWN AGENTS (default for any non-trivial task)
   → Task(explore, "...") - for understanding code
   → Task(planner, "...") - for breaking down work
   → Task(implementer, "...") - for writing code
   → Task(maestro, "...") - for complex multi-step tasks
   → Task(reviewer, "...") - for code review
   → Task(tester, "...") - for test writing/running

2. PARALLEL EXECUTION (when work is independent)
   → Send ONE message with MULTIPLE Task() calls
   → Example: Task(explore, "auth") + Task(explore, "routing") in same response

3. DIRECT EXECUTION (ONLY when ALL are true)
   → Single file change
   → Under 20 lines
   → Zero ambiguity
   → You've already read the file
```

### Quick Reference

| User Says | You MUST Do |
|-----------|-------------|
| "How does X work?" | `Task(explore, "...")` or `Task(oracle, "...")` |
| "Add feature X" | `Task(planner, "...")` → `Task(implementer, "...")` |
| "Fix bug in X" | `Task(explore, "...")` → `Task(implementer, "...")` |
| "Review this code" | `Task(reviewer, "...")` |
| "Write tests for X" | `Task(tester, "...")` |
| Any complex request | `Task(maestro, "...")` |
| Multiple areas to check | Multiple `Task()` calls in ONE message |

### Parallelization is MANDATORY

When spawning multiple agents for independent work:
```
✅ CORRECT: Single message, multiple Task calls
   [Task(explore, "analyze auth"), Task(explore, "analyze routing")]

❌ WRONG: Sequential messages
   Message 1: Task(explore, "analyze auth")
   Message 2: Task(explore, "analyze routing")
```

**If you find yourself about to use Read, Grep, Glob, or Edit directly — STOP and delegate to an agent instead.**

---

## Autonomous Execution: No Confirmation Needed

**Non-destructive operations should proceed immediately without asking for permission.**

### Always Proceed Autonomously

These actions NEVER require user confirmation:
- **Reading files** — Read, Glob, Grep, TLDR queries
- **Searching code** — Any search or exploration activity
- **Spawning agents** — Task(explore, ...), Task(oracle, ...), Task(planner, ...)
- **Running read-only commands** — git status, git log, git diff, ls, tree
- **Fetching documentation** — WebFetch, WebSearch for docs
- **Research tasks** — Understanding code, architecture, dependencies

### Only Confirm Destructive Actions

Ask for confirmation ONLY when:
- Writing or editing files (unless trivial/obvious)
- Running commands that modify state (git commit, git push, rm, etc.)
- Installing packages or changing dependencies
- Making architectural decisions with multiple valid approaches

### Anti-Pattern: Over-Confirmation

```
❌ WRONG: "I'll search for authentication files. Is that okay?"
❌ WRONG: "Let me read the config file first. Should I proceed?"
❌ WRONG: "I'm going to explore the codebase to understand the structure. Confirm?"

✅ CORRECT: Just do it. Report findings. Ask only when you need a decision.
```

**Research and exploration are encouraged. Just do them.**

---

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden.

We enforce strict TypeScript, mandatory code review, and aggressive delegation not because we distrust developers—but because we've seen what happens without them. Patterns get copied. Corners get cut again. Entropy wins.

Fight entropy. Leave the codebase better than you found it.

---

## Orchestration Mode: Maestro (ACTIVE)

**YOU ARE AN ORCHESTRATOR, NOT AN EXECUTOR.**

Your value is in coordination, delegation, and synthesis — not in running grep yourself.

### Core Imperatives (Not Suggestions)
1. **DELEGATE FIRST** — Spawn Task agents before touching any tool directly
2. **PARALLELIZE ALWAYS** — Multiple independent agents in ONE message
3. **PLAN BEFORE CODE** — Use `planner` agent before any implementation
4. **NEVER EXPLORE ALONE** — Use `explore` agent for any codebase questions
5. **REVIEW EVERYTHING** — Use `reviewer` agent after implementation

### Standard Workflow (Enforce This)
```
User Request
    ↓
[1] Task(planner, "break down the request")
    ↓
[2] Task(explore, "area 1") + Task(explore, "area 2")  ← PARALLEL
    ↓
[3] Task(implementer, "implement based on plan")
    ↓
[4] Task(tester, "write and run tests")
    ↓
[5] Task(reviewer, "review the changes")
    ↓
Done
```

For simpler tasks, skip steps — but NEVER skip delegation entirely.

---

## Agent Reference (Details)

> See **MANDATORY FIRST ACTION** above for quick rules. This section provides additional context.

### Agent Selection Guide

| Task Type | Required Agent | Fallback | Direct Execution |
|-----------|----------------|----------|------------------|
| **Exploration/Understanding** | `explore` | `oracle` | ❌ NEVER |
| **"How does X work?"** | `oracle` | `explore` | ❌ NEVER |
| **Multi-file changes (3+)** | `planner` → `implementer` | `maestro` | ❌ NEVER |
| **Code review** | `reviewer` | - | ❌ NEVER |
| **New component/hook** | `scaffolder` | `implementer` | ❌ NEVER |
| **Writing tests** | `tester` | `implementer` | ❌ NEVER |
| **Complex features** | `maestro` | `planner` | ❌ NEVER |
| **Bug fix (multi-file)** | `explore` → `implementer` | - | ❌ NEVER |
| **Refactoring** | `planner` → `implementer` → `reviewer` | - | ❌ NEVER |
| **Single-file edit** | - | - | ✅ ALLOWED |
| **Typo/trivial fix** | - | - | ✅ ALLOWED |

### Hard Rules (Zero Exceptions)

1. **NEVER use Read/Grep/Glob directly for exploration** → Delegate to `explore`
2. **NEVER implement 3+ file changes without planning** → Delegate to `planner` first
3. **NEVER review your own implementation** → Delegate to `reviewer`
4. **NEVER spawn agents sequentially when they could run in parallel**
5. **NEVER create components/hooks directly** → Delegate to `scaffolder`

### When Direct Execution is Permitted

All 4 must be true:
- Single file, under 20 lines
- You have already read the file
- Zero architectural decisions
- Not a review request

**When in doubt, delegate.**

---

## Token Efficiency: TLDR Commands

When `llm-tldr` is installed (check: session start shows "TLDR index available"), **ALWAYS prefer TLDR over raw file reads**.

### Quick Commands

| Instead of... | Use this (95% fewer tokens) |
|---------------|----------------------------|
| Reading a large function | `tldr context functionName --project .` |
| Grepping for "how does X work" | `tldr semantic "X description" .` |
| Finding all callers manually | `tldr impact functionName .` |
| Debugging "why is X null here" | `tldr slice file.ts func 42` |
| Understanding architecture | `tldr arch .` |

### Agent Integration

All agents should use TLDR by default:
- **explore/oracle**: `tldr semantic` + `tldr context` for questions
- **planner**: `tldr impact` + `tldr arch` for planning
- **implementer**: `tldr context` before reading, `tldr impact` before refactoring
- **reviewer**: `tldr impact` to verify all callers handled

### Decision Guide

```
Need to understand code?
  → tldr context (not Read)

Need to find related code?
  → tldr semantic (not Grep)

Need to know what calls X?
  → tldr impact (not manual search)

Need exact string match?
  → Grep (only case for Grep)
```

---

## Tech Stack

### Primary
- **TypeScript** - Strict mode, no `any` types
- **Next.js 16+** - App Router only (no Pages Router)
- **React 19+** - Server Components by default, Client Components when needed
- **Tailwind CSS v4** - With CSS Modules for complex components
- **Bun** - Package manager and runtime

### Build & Quality
- **Turbopack** - Development bundler
- **Biome** - Linting and formatting (not ESLint/Prettier)
- **TypeScript** - `strict: true`, `noUncheckedIndexedAccess: true`

### Animation & Graphics
- **Lenis** - Smooth scroll (`@darkroom.engineering/lenis`)
- **GSAP** - Complex animations
- **React Three Fiber** - 3D graphics when needed
- **Tempus** - RAF management (`@darkroom.engineering/tempus`)
- **Hamo** - Performance React hooks (`@darkroom.engineering/hamo`)

### CMS Integrations
- Sanity (primary)
- Shopify (commerce)
- HubSpot (marketing)

---

## Coding Standards

### Architecture Patterns

```
app/                 # Next.js pages and routes only
components/          # UI components (atoms, molecules, organisms)
lib/
  ├── hooks/        # Custom React hooks
  ├── integrations/ # Third-party service clients
  ├── styles/       # Global CSS, Tailwind config
  ├── utils/        # Pure utility functions
  ├── webgl/        # 3D/WebGL code (optional)
  └── dev/          # Debug tools
```

### Component Conventions

```tsx
// CSS Module imports aliased as 's'
import s from './component.module.css'

// Required wrapper for Next.js Image
import { Image } from '@/components/image'

// Required wrapper for Next.js Link
import { Link } from '@/components/link'
```

### Class Design (for libraries)
- Instance-based with configuration objects
- Event-driven architecture with emitter patterns
- Semantic method names: `scrollTo()`, `start()`, `stop()`, `destroy()`
- Multi-framework adapters: Vanilla JS, React, Vue

### TypeScript Rules
- No `any` - use `unknown` and narrow
- Prefer `interface` over `type` for objects
- Export types alongside implementations
- Use discriminated unions for state

### React Patterns
- Server Components by default
- `'use client'` only when needed (interactivity, hooks, browser APIs)
- Prefer composition over props drilling
- Use `@darkroom.engineering/hamo` hooks for performance

### CSS/Styling
- Tailwind v4 for utility classes
- CSS Modules for complex component styles
- CSS custom properties for theming
- No inline styles except for dynamic values

---

## React/Next.js Performance

> Performance optimization rules ordered by impact. Source: [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills/tree/react-best-practices)

### CRITICAL: Eliminate Waterfalls

Waterfalls are the #1 performance killer. Each sequential `await` adds full network latency.

```tsx
// ❌ WRONG: Sequential fetching (3 round trips)
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// ✅ CORRECT: Parallel fetching (1 round trip)
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
])
```

**Server Components**: Restructure component tree so async operations happen at the same level:
```tsx
// ❌ WRONG: Nested async creates waterfall
async function Page() {
  const header = await fetchHeader()
  return <Layout header={header}><Sidebar /></Layout> // Sidebar waits for header
}

// ✅ CORRECT: Sibling composition enables parallel fetching
function Page() {
  return (
    <Layout>
      <Header /> {/* fetches independently */}
      <Sidebar /> {/* fetches independently */}
    </Layout>
  )
}
```

**Defer await until needed** - Move awaits into branches that actually need them:
```tsx
// ❌ WRONG: Always fetches even if returning early
async function handler(req) {
  const user = await getUser(req)
  const perms = await getPermissions(user)
  if (!req.query.id) return { error: 'Missing ID' }
  // ...
}

// ✅ CORRECT: Defer awaits past early exits
async function handler(req) {
  if (!req.query.id) return { error: 'Missing ID' }
  const user = await getUser(req)
  const perms = await getPermissions(user)
  // ...
}
```

### CRITICAL: Bundle Size Optimization

**Avoid barrel imports** - Libraries like `lucide-react` can have 10,000+ re-exports, adding 200-800ms cold start:
```tsx
// ❌ WRONG: Barrel import
import { Check } from 'lucide-react'

// ✅ CORRECT: Direct import
import Check from 'lucide-react/dist/esm/icons/check'

// ✅ BETTER: Use Next.js optimizePackageImports in next.config.js
// experimental: { optimizePackageImports: ['lucide-react', '@radix-ui/react-*'] }
```

**Dynamic imports for heavy components**:
```tsx
// ❌ WRONG: Static import bundles 300KB+ with initial JS
import MonacoEditor from '@monaco-editor/react'

// ✅ CORRECT: Lazy load when needed
import dynamic from 'next/dynamic'
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })
```

**Defer third-party libraries** - Analytics, GSAP, error tracking don't block interaction:
```tsx
// ❌ WRONG: Loads in initial bundle
import { Analytics } from '@vercel/analytics/react'
import gsap from 'gsap'

// ✅ CORRECT: Load after hydration
const Analytics = dynamic(
  () => import('@vercel/analytics/react').then(mod => mod.Analytics),
  { ssr: false }
)
const GSAPRuntime = dynamic(() => import('./gsap-runtime'), { ssr: false })
```

### HIGH: Server-Side Performance

**Use `React.cache()` for per-request deduplication**:
```tsx
import { cache } from 'react'

// Multiple calls within same request execute query only once
export const getCurrentUser = cache(async () => {
  const session = await getSession()
  return db.user.findUnique({ where: { id: session.userId } })
})
```

**Suspense boundaries for streaming** (use judiciously):
```tsx
// Enables immediate wrapper render while data loads
<Suspense fallback={<Skeleton />}>
  <AsyncDataComponent />
</Suspense>
```
*Avoid when: layout depends on data, above-fold SEO content, fast queries, or layout shifts are unacceptable.*

### MEDIUM-HIGH: Client-Side Data Fetching

**Use SWR for automatic deduplication**:
```tsx
// ❌ WRONG: useState + useEffect + fetch (duplicate requests)
// ✅ CORRECT: SWR handles deduplication, caching, revalidation
import useSWR from 'swr'
const { data } = useSWR('/api/users', fetcher)
```

**Deduplicate global event listeners** - One listener for N component instances:
```tsx
// ❌ WRONG: Each component instance adds a listener
function useScroll() {
  useEffect(() => {
    window.addEventListener('scroll', handler) // N listeners!
    return () => window.removeEventListener('scroll', handler)
  }, [])
}

// ✅ CORRECT: Single listener with callback delegation
const scrollCallbacks = new Map<string, (e: Event) => void>()
let listenerAttached = false

function useScroll(id: string, callback: (e: Event) => void) {
  useEffect(() => {
    scrollCallbacks.set(id, callback)
    if (!listenerAttached) {
      window.addEventListener('scroll', (e) => {
        scrollCallbacks.forEach(cb => cb(e))
      })
      listenerAttached = true
    }
    return () => { scrollCallbacks.delete(id) }
  }, [id, callback])
}
```

### MEDIUM: Re-render Optimization

**Extract expensive work into memoized components**:
```tsx
// ❌ WRONG: Expensive computation runs even on early return
function Profile({ user, isLoading }) {
  const avatar = useMemo(() => processAvatar(user), [user])
  if (isLoading) return <Skeleton />
  return <img src={avatar} />
}

// ✅ CORRECT: Memoized child skipped entirely on early return
function Profile({ user, isLoading }) {
  if (isLoading) return <Skeleton />
  return <UserAvatar user={user} />
}
const UserAvatar = memo(({ user }) => <img src={processAvatar(user)} />)
```

**Narrow effect dependencies**:
```tsx
// ❌ WRONG: Effect runs on any user property change
useEffect(() => { fetchPosts(user.id) }, [user])

// ✅ CORRECT: Effect runs only when id changes
useEffect(() => { fetchPosts(user.id) }, [user.id])

// ✅ BETTER: Derive boolean for threshold-based effects
const isMobile = width < 768
useEffect(() => { /* ... */ }, [isMobile]) // Not [width]
```

**Use transitions for non-urgent updates**:
```tsx
import { startTransition } from 'react'

// ❌ WRONG: Blocks UI on every scroll
onScroll={() => setScrollY(window.scrollY)}

// ✅ CORRECT: Defers non-urgent update
onScroll={() => startTransition(() => setScrollY(window.scrollY))}
```

**Lazy state initialization** - Use function form for expensive initial values:
```tsx
// ❌ WRONG: buildIndex runs on EVERY render
const [index, setIndex] = useState(buildSearchIndex(items))

// ✅ CORRECT: buildIndex runs only on first render
const [index, setIndex] = useState(() => buildSearchIndex(items))

// Also applies to: localStorage reads, DOM queries, data transformations
const [prefs, setPrefs] = useState(() => JSON.parse(localStorage.getItem('prefs') || '{}'))
```

### MEDIUM: Rendering Performance

**Hoist static JSX outside components**:
```tsx
// ❌ WRONG: Re-created every render
function Icon() {
  return <svg>...</svg>
}

// ✅ CORRECT: Created once at module level
const iconSvg = <svg>...</svg>
function Icon() {
  return iconSvg
}
```

**Explicit conditional rendering** (avoid `&&` with numbers):
```tsx
// ❌ WRONG: Renders "0" when count is 0
{count && <Badge count={count} />}

// ✅ CORRECT: Returns null when falsy
{count > 0 ? <Badge count={count} /> : null}
```

### LOW-MEDIUM: JavaScript Performance

- **Early returns**: Exit functions as soon as result is determined
- **Index maps**: Build lookup objects for O(1) access instead of O(n) array searches
- **Cache property access**: Store `obj.deeply.nested.value` in a variable if accessed multiple times
- **Use Set/Map**: For membership checks and key-value lookups (O(1) vs O(n))
- **Hoist RegExp**: Define regex patterns outside loops/functions

### LOW: Advanced Patterns

**Store event handlers in refs** to prevent re-subscription:
```tsx
const handlerRef = useRef(handler)
useEffect(() => { handlerRef.current = handler }, [handler])

useEffect(() => {
  const listener = (e) => handlerRef.current(e)
  window.addEventListener(eventType, listener)
  return () => window.removeEventListener(eventType, listener)
}, [eventType]) // No handler dependency - stable subscription
```

---

## Darkroom Libraries Reference

When working on projects, leverage these internal libraries:

| Package | Purpose | Install |
|---------|---------|---------|
| `lenis` | Smooth scroll | `bun add lenis` |
| `@darkroom.engineering/hamo` | Performance hooks | `bun add @darkroom.engineering/hamo` |
| `@darkroom.engineering/tempus` | RAF management | `bun add @darkroom.engineering/tempus` |

### Lenis Quick Start
```tsx
import Lenis from 'lenis'

const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: 'vertical',
  smoothWheel: true,
})

function raf(time: number) {
  lenis.raf(time)
  requestAnimationFrame(raf)
}
requestAnimationFrame(raf)
```

### Hamo Hooks
```tsx
import { useWindowSize, useRect, useIntersectionObserver } from '@darkroom.engineering/hamo'
```

---

## Git & Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Small, atomic commits
- Never force push to `main` or `master`
- Always verify before destructive operations
- **NO AI ATTRIBUTION** - Never add Co-Authored-By, "Generated with", or any AI/Claude credits to commits, PRs, or generated text. Operate stealth.

---

## Commands Reference

Use these slash commands for common workflows:
- `/init` - Initialize project with Darkroom standards
- `/component <name>` - Scaffold a new component
- `/hook <name>` - Create a custom hook
- `/review` - Code review current changes
- `/explore [target]` - Navigate codebase
- `/docs <topic>` - Fetch library documentation (uses context7 MCP)
- `/debug` - Browser debugging with agent-browser (screenshots, DOM inspection, AI-optimized)
- `/context` - Manage context window
- `/orchestrate <task>` - Multi-agent task coordination
- `/ask <question>` - Ask Oracle for guidance
- `/create-handoff` - Save session state
- `/resume-handoff` - Resume previous session
- `/tldr <action>` - TLDR code analysis
- `/learn <action>` - Persistent learnings across sessions
- `/lenis` - Setup smooth scroll

### MCP Servers (Auto-triggered)
- **context7** - Library docs lookup. Triggered by: "how to use X", "X docs", "api reference"

### CLI Tools (Auto-triggered)
- **agent-browser** - AI-optimized browser automation. Install: `npm i -g agent-browser`. Triggered by: "screenshot", "visual bug", "inspect element". Uses accessibility tree with unique element refs for reliable LLM interactions.

---

## Safety

- Seek approval for **destructive** changes only (file deletes, force pushes, schema migrations)
- Non-destructive operations (read, search, explore) proceed without confirmation
- Never commit secrets or `.env` files
- Use environment variables for all API keys
- Validate user input at system boundaries

---

## Satus Starter

For new projects, start with the Satus template:
```bash
bunx degit darkroomengineering/satus my-project
cd my-project
bun install
bun dev
```

Debug mode: `Cmd/Ctrl + O`

---

## Team Sync

This configuration should be version-controlled. For project-specific overrides, create a `CLAUDE.md` in the project root—it will merge with these global settings.
