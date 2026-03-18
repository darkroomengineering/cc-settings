# Feature Agents Guide

How to create project-specific feature agents that compose the role-based agents from cc-settings.

---

## Role Agents vs Feature Agents

cc-settings ships with **role agents** -- general-purpose agents defined by what they do:

| Role Agent | Purpose |
|------------|---------|
| `explore` | Read-only codebase navigation |
| `planner` | Task breakdown and architecture |
| `implementer` | Code writing and editing |
| `reviewer` | Code review against standards |
| `tester` | Test writing and execution |
| `scaffolder` | Boilerplate generation |
| `deslopper` | Dead code removal and cleanup |
| `oracle` | Expert Q&A and guidance |
| `maestro` | Multi-agent orchestration |
| `security-reviewer` | Security audit |

**Feature agents** are project-specific agents defined by what they know. They encode domain knowledge and delegate execution to role agents.

| Concept | Role Agent | Feature Agent |
|---------|-----------|---------------|
| Defined by | Capability (explore, implement, review) | Domain (auth, CMS, payments) |
| Scope | All projects | Single project |
| Ships with | cc-settings (global) | Your project (local) |
| Location | `~/.claude/agents/` | `<project>/.claude/agents/` |
| Delegates to | Tools directly | Role agents via `Agent()` |

---

## When to Create Feature Agents

Create a feature agent when:

- **Domain complexity**: The area has non-obvious rules, patterns, or gotchas that Claude needs to know every time.
- **Recurring workflows**: You find yourself explaining the same context repeatedly across sessions.
- **Team-specific patterns**: The project uses conventions that differ from generic best practices.
- **Integration knowledge**: External service integrations have specific API patterns, auth flows, or data models.

Do NOT create a feature agent when:

- A role agent already handles the task well without extra context.
- The domain knowledge fits better as a learning (`/learn`) or a rule (`rules/*.md`).
- The agent would be so broad it duplicates the Maestro.

---

## Template

Place feature agents in your project at `.claude/agents/<name>.md`.

```markdown
---
name: auth-agent
model: opus
allowedTools: [Task, Read, Grep, Glob]
description: |
  Handles authentication features for this project.

  DELEGATE when user asks:
  - "Add login flow" / "Fix auth issue" / "Session handling"
  - "OAuth setup" / "JWT token" / "Protected route"
  - Any task involving authentication, authorization, or sessions

  RETURNS: Implementation via role agents, domain-aware guidance
---

# Auth Agent

You are a specialist for the authentication system in this project.

## Domain Knowledge

- Auth uses NextAuth.js v5 with JWT strategy
- Session stored in httpOnly cookies, 30-day expiry
- OAuth providers: Google, GitHub (configured in `lib/auth/providers.ts`)
- Protected routes use middleware at `middleware.ts`
- Role-based access: `admin`, `editor`, `viewer` (defined in `lib/auth/roles.ts`)
- API routes check session via `auth()` from `@/lib/auth`

## Key Files

- `lib/auth/index.ts` -- NextAuth configuration
- `lib/auth/providers.ts` -- OAuth provider setup
- `lib/auth/roles.ts` -- Role definitions and permission checks
- `middleware.ts` -- Route protection
- `app/api/auth/[...nextauth]/route.ts` -- Auth API routes
- `components/auth/` -- Login, signup, session UI components

## Common Patterns

### Protecting an API Route
```typescript
import { auth } from '@/lib/auth'

export async function GET() {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  // ...
}
```

### Checking Roles
```typescript
import { hasRole } from '@/lib/auth/roles'

if (!hasRole(session.user, 'admin')) {
  return new Response('Forbidden', { status: 403 })
}
```

## Workflow

For any auth-related task:

1. **Explore first**: `Agent(explore, "Map the current auth flow for [feature]")`
2. **Plan changes**: `Agent(planner, "Plan [auth change] considering session handling and role checks")`
3. **Implement**: `Agent(implementer, "Implement [auth feature] following the patterns in lib/auth/")`
4. **Security review**: `Agent(security-reviewer, "Review auth changes for OWASP vulnerabilities")`
5. **Test**: `Agent(tester, "Write tests for [auth feature] covering happy path and unauthorized access")`

## Gotchas

- NEVER store tokens in localStorage -- cookies only
- Always validate session server-side, never trust client-side checks alone
- OAuth callback URL must match exactly in provider config
- Role changes require session refresh (call `update()` on session)
```

---

## Examples of Good Feature Agents

### CMS Content Agent

For projects using Sanity, Contentful, or similar:

```markdown
---
name: cms-agent
model: opus
allowedTools: [Task, Read, Grep, Glob]
description: |
  Manages CMS content integration (Sanity).

  DELEGATE when user asks:
  - "Add content type" / "GROQ query" / "Schema change"
  - "Fetch content" / "Preview" / "Webhook"
---

# CMS Agent

## Domain Knowledge

- CMS: Sanity v3 with live preview
- Schemas defined in `sanity/schemas/`
- GROQ queries in `lib/sanity/queries.ts`
- Content fetched via `lib/sanity/client.ts`
- Preview mode uses draft content with `draftMode()`
- Webhook at `/api/sanity/webhook` triggers ISR revalidation

## Key Patterns

### Adding a New Content Type
1. Create schema in `sanity/schemas/<type>.ts`
2. Register in `sanity/schemas/index.ts`
3. Add GROQ query in `lib/sanity/queries.ts`
4. Create fetch function in `lib/sanity/fetchers.ts`
5. Build component to render the content

## Workflow

1. `Agent(explore, "Check existing Sanity schemas and query patterns")`
2. `Agent(planner, "Plan content type addition with schema, query, and component")`
3. `Agent(scaffolder, "Create schema file following existing pattern")`
4. `Agent(implementer, "Implement GROQ query and data fetching")`
5. `Agent(tester, "Test content fetching with mock data")`
```

### Animation Agent

For projects with complex animations:

```markdown
---
name: animation-agent
model: opus
allowedTools: [Task, Read, Grep, Glob]
description: |
  Handles animations and transitions using GSAP, Lenis, and Tempus.

  DELEGATE when user asks:
  - "Add animation" / "Scroll effect" / "Page transition"
  - "GSAP timeline" / "ScrollTrigger" / "Smooth scroll"
---

# Animation Agent

## Domain Knowledge

- GSAP for complex animations (always fetch docs first)
- Lenis for smooth scrolling (`bun add lenis@latest`)
- Tempus for RAF management (`bun add tempus@latest`)
- Hamo hooks for performance (`bun add hamo@latest`)
- Animate ONLY `transform` and `opacity` (compositor properties)
- Honor `prefers-reduced-motion` in all animations

## Workflow

1. `Agent(explore, "fetch docs for [GSAP/Lenis/library]")` -- ALWAYS fetch current docs
2. `Agent(planner, "Plan animation approach considering performance and reduced-motion")`
3. `Agent(implementer, "Implement animation using [library] following fetched docs")`
4. `Agent(reviewer, "Review animation for performance: only compositor properties, cleanup on unmount")`
```

### API Integration Agent

For projects with multiple external API integrations:

```markdown
---
name: api-agent
model: opus
allowedTools: [Task, Read, Grep, Glob]
description: |
  Manages external API integrations (Stripe, SendGrid, etc.).

  DELEGATE when user asks:
  - "Add Stripe payment" / "Send email" / "Third-party API"
  - "Webhook handler" / "API client" / "Rate limiting"
---

# API Integration Agent

## Domain Knowledge

- All API clients live in `lib/integrations/<service>/`
- Each integration has: `client.ts` (SDK setup), `actions.ts` (server actions), `types.ts`
- API keys stored in env vars, never hardcoded
- Webhook handlers at `app/api/webhooks/<service>/route.ts`
- All external calls wrapped in try/catch with structured error logging

## Workflow

1. `Agent(explore, "Check existing integrations for patterns")`
2. `Agent(planner, "Plan [service] integration with error handling and types")`
3. `Agent(implementer, "Build integration client and server actions")`
4. `Agent(security-reviewer, "Verify API keys not exposed, webhook signatures validated")`
5. `Agent(tester, "Write tests with mocked API responses")`
```

---

## Anti-Patterns

### Do Not Recreate Role Agents

Wrong -- this duplicates what `implementer` already does:

```markdown
---
name: auth-implementer
description: "Implements auth code"
tools: [Read, Write, Edit, Bash, ...]
---

You write authentication code. Follow TypeScript strict mode...
```

Right -- delegate to the role agent with domain context:

```markdown
---
name: auth-agent
description: "Auth domain specialist"
allowedTools: [Task, Read, Grep, Glob]
---

## Workflow
1. Agent(implementer, "Implement [feature] using the auth patterns in lib/auth/")
```

### Do Not Make Agents Too Broad

Wrong -- this is just a worse Maestro:

```markdown
---
name: project-agent
description: "Handles everything in this project"
---
```

Right -- scope to a specific domain:

```markdown
---
name: auth-agent
description: "Handles authentication features"
---
```

### Do Not Embed Implementation Details

Wrong -- hardcoding code that will go stale:

```markdown
## How to Add a Protected Route

Copy this exact code:
\`\`\`typescript
// 50 lines of specific implementation
\`\`\`
```

Right -- reference patterns by location:

```markdown
## How to Add a Protected Route

Follow the pattern in `middleware.ts` and `lib/auth/index.ts`.
Delegate to `Agent(explore, "Show the route protection pattern in middleware.ts")` for current implementation.
```

### Do Not Skip Security Review

Wrong -- implementing auth without security check:

```markdown
## Workflow
1. Agent(planner, "Plan auth feature")
2. Agent(implementer, "Build it")
3. Done!
```

Right -- always include security review for sensitive domains:

```markdown
## Workflow
1. Agent(planner, "Plan auth feature")
2. Agent(implementer, "Build it")
3. Agent(security-reviewer, "Audit for OWASP vulnerabilities")
4. Agent(tester, "Test including unauthorized access paths")
```

---

## Checklist for Creating a Feature Agent

Before shipping a feature agent, verify:

- [ ] **Scoped to a domain**, not a role (it knows things, not just does things)
- [ ] **Delegates to role agents** via `Agent()` instead of using tools directly
- [ ] **Documents key files** so role agents know where to look
- [ ] **Lists gotchas** that are non-obvious and project-specific
- [ ] **Includes a workflow** with the standard pattern: explore, plan, implement, review, test
- [ ] **Uses `allowedTools: [Task, Read, Grep, Glob]`** -- read-only plus delegation
- [ ] **Lives in `.claude/agents/`** within the project (not globally)
- [ ] **Security review step** included for sensitive domains (auth, payments, PII)
