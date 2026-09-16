---
paths:
  - "**/*.swift"
---

# Swift Animation Performance

Every animation in an iOS, iPadOS, or macOS app renders at the display's maximum
refresh rate (120 Hz on ProMotion, 60 Hz elsewhere) with no dropped frames.

> Source: WWDC23 session 10156 "Explore SwiftUI animation" (Kyle, SwiftUI team),
> plus Apple's ProMotion documentation for the frame-rate keys the session does
> not cover. Vocabulary, easing budgets, and interruptibility physics shared with
> web work live in `rules/motion-physics.md`.

## Keep every frame off `body`

- Animate with built-in animatable modifiers (`scaleEffect`, `opacity`, `offset`,
  `rotationEffect`, `frame`, `position`, `shadow`, `blur`). SwiftUI interpolates
  their `animatableData` off the main thread without calling your view code, so
  they hit the display rate for free.
- A custom `Animatable` conformance turns `body` into the animatable attribute:
  SwiftUI calls `body` and reruns layout on every frame of the animation. Use it
  only when no built-in effect produces the motion (an arc through a custom
  `Layout`, custom `Shape` or `Canvas` drawing). Keep that `body` pure arithmetic:
  no allocation, no data traversal, no fetches, no formatters.
- `CustomAnimation.animate` runs once per frame per animating attribute. Keep it
  to vector math over the delta; return `nil` the moment the animation is done so
  the attribute stops ticking.
- Never drive motion from `Timer`, `DispatchQueue.asyncAfter`, or a loop that
  mutates state per tick. Use SwiftUI animations, `PhaseAnimator`,
  `KeyframeAnimator`, `TimelineView`, or `CADisplayLink`.

## Springs by default, interruptible always

- Prefer `withAnimation` (a smooth spring since iOS 17) or an explicit
  `.spring(duration:bounce:)`, `.smooth`, `.snappy`, `.bouncy`. Springs implement
  `shouldMerge` and carry velocity, so a retarget mid-flight continues from the
  live presentation value instead of snapping.
- Timing-curve animations (`easeInOut`, `linear`, custom `UnitCurve`) combine
  additively when interrupted. Reserve them for changes the user cannot re-trigger
  while they run.
- Accept new input at any moment. Never gate a gesture on an animation finishing,
  and never read a model value as if it were the on-screen value mid-animation.

## Scope animations, prevent accidental ones

- Attach `.animation(_:value:)` to the value that changed. A bare
  `.transaction { $0.animation = … }` or a `withAnimation` around unrelated state
  animates every downstream change in that update and spends frames on motion no
  one asked for.
- For containers with arbitrary child content, use the body-closure form
  `.animation(_:) { view in … }` so the animation reaches only the effects named
  inside the closure and the children keep the original transaction.
- Give each effect its own animation when they should differ (bouncy spring on
  `scaleEffect`, smooth spring on `shadow`) by stacking scoped `.animation`
  modifiers between them.
- Distinguish interactive from programmatic updates with a custom
  `TransactionKey` and `withTransaction`, not with extra `@State`.

## Unlock the display's full rate

- iPhone: set `CADisableMinimumFrameDurationOnPhone` to `true` in `Info.plist`.
  Without it, `CADisplayLink` callbacks and `CAAnimation` stay capped at 60 Hz on
  ProMotion iPhones. iPad and Mac do not need the key.
- Custom render loops declare `CADisplayLink.preferredFrameRateRange` with a
  `CAFrameRateRange` whose `preferred` value is the display maximum. The range is
  a hint the system may lower under load; built-in SwiftUI animations follow the
  system rate on their own.
- Respect `accessibilityReduceMotion`: replace movement with a crossfade or
  opacity change; never simply remove the state change.

## Verify before shipping

- Profile on a ProMotion device with Instruments "Animation Hitches" (or the
  Core Animation FPS instrument). The bar is zero hitches and the frame rate at
  the display maximum for the whole animation.
- Confirm `body` is not called per frame during built-in animations by placing a
  breakpoint or `Self._printChanges()` in the view and running the animation.
- Feel-check with Simulator "Slow Animations" (Debug menu) and on-device at full
  speed; both must look continuous, with no jump at interruption.
