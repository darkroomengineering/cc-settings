---
paths:
  - "**/*.swift"
---

# Swift

Concurrency, testing, and logging defaults for Swift 6.2 and later. Animation
lives in `rules/swift-animation.md`.

> Adapted from emilkowalski/skills `write-swift` (MIT). Isolation semantics per
> SE-0461 and SE-0466; check the project's build settings before relying on them.

## Concurrency: single-threaded until Instruments says otherwise

Move up this ladder one step at a time, and only on evidence:

1. Everything on the main actor.
2. `async`/`await` to wait on I/O; SDK calls such as `URLSession` already offload.
3. `@concurrent` on your own CPU-heavy function, after Instruments shows a hang.
4. An `actor`, when main-actor state forces constant hops back.

- **Build settings first.** App and UI modules enable Approachable Concurrency and
  set Default Actor Isolation to `MainActor` (SwiftPM:
  `.defaultIsolation(MainActor.self)`). Libraries never default to the main
  actor; their APIs are `nonisolated` so the caller decides.
- **Where an `async` function runs depends on a setting.** With
  `NonisolatedNonsendingByDefault` (part of Approachable Concurrency), a
  `nonisolated async` function runs on the caller's actor; without it, it hops
  to the global pool. `@concurrent` always leaves the actor.
- **`await` breaks atomicity.** Re-check state after every suspension, never hold
  a lock across one, and mutate actor state in synchronous actor methods.
  Check-cache, `await` download, write-cache double-downloads: re-check after the
  `await` or dedupe the in-flight task.
- **Structured first.** `async let` for a fixed number of children,
  `withTaskGroup` (bounded) for a dynamic number, `Task { }` only inside a UI
  callback. Not `Task.detached` or `DispatchQueue.global()`.
- **Cancellation is cooperative:** `try Task.checkCancellation()` before
  expensive work.
- **Continuations resume exactly once on every path.**
- **SwiftUI action callbacks stay synchronous.** Start `withAnimation` in the
  callback and open a `Task` only for the work that follows. In `@Sendable`
  closures (`visualEffect`, `Layout`, `onGeometryChange`) capture the one value
  you need, not `self`.

## Sendable

Fix a data-race error in this order: stop sharing the object, make it a
`Sendable` value type, isolate it to an actor, then `Mutex` / `Atomic`.
`@unchecked Sendable` and `nonisolated(unsafe)` are for types with real internal
synchronization, never a way to silence the compiler. Model classes stay
non-`Sendable` (or `@MainActor`).

## Testing and logging

- New tests use Swift Testing: `@Test`, `#expect`, `try #require`,
  `@Test(arguments:)` instead of loops, `withKnownIssue` instead of commenting a
  test out. XCTest stays for UI automation and `XCTMetric` performance tests.
- `Logger` from `os`, one per subsystem and category, never `print`. Mark only
  non-personal values `privacy: .public`.
