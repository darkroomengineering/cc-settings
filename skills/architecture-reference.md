# Architecture Reference Material

Pattern reference, anti-patterns, and checklists for the `planner` agent.

---

## Common Architectural Patterns Reference

### Frontend Patterns

| Pattern | When to Use | Watch Out For |
|---------|-------------|---------------|
| **Component Composition** | Reusable UI pieces, flexible layouts | Over-abstraction, prop drilling |
| **Code Splitting** | Large bundles, route-based loading | Waterfall loading, flash of content |
| **State Colocation** | State used by single component tree | Lifting state too high |
| **Context + Reducer** | Cross-cutting concerns, complex state | Context hell, unnecessary re-renders |
| **Server Components** | Data fetching, static content | Interactivity boundaries |
| **Optimistic Updates** | Frequent user actions, good UX | Rollback complexity |

### Backend Patterns

| Pattern | When to Use | Watch Out For |
|---------|-------------|---------------|
| **Repository Pattern** | Data access abstraction, testability | Over-engineering simple CRUD |
| **Service Layer** | Business logic isolation | Anemic domain model |
| **Event-Driven** | Decoupling, async processing | Eventual consistency, debugging |
| **CQRS** | Different read/write models | Complexity, sync issues |
| **Middleware Chain** | Cross-cutting concerns | Order dependencies |

### Data Patterns

| Pattern | When to Use | Watch Out For |
|---------|-------------|---------------|
| **Caching (SWR/React Query)** | Reduce server load, improve UX | Stale data, cache invalidation |
| **Normalization** | Relational data, avoid duplication | Query complexity |
| **Denormalization** | Read performance, simple queries | Update anomalies |
| **Optimistic Locking** | Concurrent edits | Conflict resolution UX |

---

## Red Flags / Anti-Patterns

**Architecture Smells**
- God objects/components (doing too much)
- Circular dependencies between modules
- Leaky abstractions (implementation details exposed)
- Shared mutable state across boundaries
- Tight coupling to external services
- Missing error boundaries/handling

**Code Organization Smells**
- Barrel files with 100+ exports
- Deep nesting (> 4 levels)
- Mixed concerns in single file
- Inconsistent naming conventions
- No clear ownership boundaries

**Performance Smells**
- N+1 query patterns
- Unbounded data fetching
- Missing loading/error states
- Render waterfalls
- Memory leaks (event listeners, subscriptions)

**Security Smells**
- User input not validated at boundaries
- Secrets in code or version control
- Missing authentication/authorization checks
- Overly permissive CORS/CSP

---

## Non-Functional Requirements Checklist

Before finalizing the plan, verify these are addressed:

### Performance
- [ ] Response time targets defined
- [ ] Bundle size impact assessed
- [ ] Database query performance considered
- [ ] Caching strategy defined
- [ ] Lazy loading opportunities identified

### Security
- [ ] Input validation at boundaries
- [ ] Authentication/authorization requirements
- [ ] Sensitive data handling (PII, secrets)
- [ ] OWASP top 10 considerations
- [ ] Audit logging needs

### Reliability
- [ ] Error handling strategy
- [ ] Retry/fallback mechanisms
- [ ] Graceful degradation plan
- [ ] Monitoring/alerting needs
- [ ] Recovery procedures

### Maintainability
- [ ] Code organization clear
- [ ] Documentation needs identified
- [ ] Testing strategy defined
- [ ] Migration/rollback plan
- [ ] Technical debt acknowledged

### Observability
- [ ] Logging strategy
- [ ] Metrics to track
- [ ] Tracing requirements
- [ ] Debug tooling needs

---

## Scalability Considerations Checklist

Evaluate before finalizing the plan:

**Data Scale**
- [ ] How much data will this handle? (10, 1K, 1M, 1B records)
- [ ] What's the growth rate?
- [ ] Are there pagination/virtualization needs?

**Traffic Scale**
- [ ] Expected requests per second?
- [ ] Burst capacity requirements?
- [ ] Geographic distribution?

**Complexity Scale**
- [ ] Will this pattern be repeated elsewhere?
- [ ] How many developers will touch this code?
- [ ] What's the expected lifetime of this code?

**Resource Scale**
- [ ] Memory footprint considerations?
- [ ] CPU/compute requirements?
- [ ] Network bandwidth implications?
