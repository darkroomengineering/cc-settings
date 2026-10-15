---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "components/**/*"
---

# Motion Physics & Vocabulary

> Adapted from emilkowalski/skills (MIT) — `apple-design`, `animation-vocabulary`, `emil-design-eng`.
>
> Clip-path recipes, the debugging-feel workflow, and the naming table live in `~/.claude/docs/motion-reference.md` — read that when doing motion work. Per-diff enforcement of these values is `/review`.

## Should this animate?

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |
| Tens of times/day (hover, list navigation) | Near-imperceptible only, or nothing |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare / first-time (onboarding, success, celebration) | The delight budget lives here |

Purpose must be one of: feedback, spatial consistency, state indication, preventing a
jarring change, explanation (marketing/onboarding only), or delight (rare tier only).
"It looks cool" on a frequently-seen element is not a reason to animate.

## Easing tokens

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* entering/exiting */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* moving/morphing on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer curve */
```

Built-in CSS easings are too weak for deliberate UI motion — extend these tokens,
never invent parallel ones. Use plain `ease` for hover/color changes, `linear` for
constant motion (marquee, progress bars).

## Duration budget

| Element | Duration |
| --- | --- |
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, drawers | 200–500ms |
| Marketing / explanatory | Can be longer |

UI animations stay under 300ms — modals and drawers are the sanctioned exception,
up to 500ms.

## Never ship

- `ease-in` on a UI element — use `ease-out` or a token above.
- `transform: scale(0)` entrances — start `scale(0.9–0.97)` + `opacity: 0`.
- Animating anything but `transform` and `opacity` — `width`/`height`/`margin`/`padding`/`top`/`left` trigger layout and paint. The one named exception is `clip-path` for reveals and wipes: it repaints without layout. It is not compositor-guaranteed in every browser, so verify on target devices when it runs during a gesture.
- Keyframes on toasts, toggles, or anything a user can trigger rapidly — use CSS
  transitions instead, so retriggering retargets from the current value instead of
  restarting from zero.
- Ungated `:hover` motion — gate behind `@media (hover: hover) and (pointer: fine)`
  (touch fires false hovers on tap). Tailwind v4's `hover:` variant already wraps in `(hover: hover)`; hand-written CSS Module hover motion uses the media query.

## Press feedback

Removing the tap highlight makes `:active` feedback mandatory: `scale(0.95-0.98)`, 100-160ms, transition inside `prefers-reduced-motion: no-preference`. Script listeners use `pointerdown` for immediate feedback.

## Interruptibility — the single most important rule for gesture-driven motion

Every animation a user can touch must be interruptible and redirectable at any
moment. A closing drawer the user grabs again should follow the finger, not finish
closing first.

- Animate from the element's live **presentation value**, never its logical target.
  On interrupt, read the current on-screen transform and start the new animation
  from there — starting from the target value causes a visible jump.
- Avoid CSS transitions/`@keyframes` for anything gesture-driven — they can't be
  smoothly grabbed and reversed mid-flight. Reach for a spring library instead
  (Motion/Framer Motion), which animates from the current value by default.
- Decompose 2D drag motion into independent X and Y springs — a single spring on a
  2D distance desyncs when X and Y carry different velocities.

## Direct manipulation — 1:1 tracking

Touch and content move together. Use Pointer Events with `setPointerCapture` so
tracking continues even when the pointer leaves the element's bounds, and respect
the offset from where the user grabbed it — snapping to center on grab breaks the
illusion immediately. On touch, also set `touch-action` on the draggable (`none`,
or `pan-y` for a horizontal drag) — pointer capture alone doesn't stop the
browser's native pan/zoom from cancelling the drag — and handle `pointercancel` /
`lostpointercapture` to settle the element instead of leaving it stranded
mid-drag.

## Spring defaults

Use Apple's designer-friendly parameters (`duration` + `bounce`) over raw
stiffness/damping — easier to reason about.

```js
{ type: "spring", duration: 0.5, bounce: 0.2 }            // Apple-style — preferred
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }  // traditional physics — more control
```

- Default to **no overshoot** (critically damped, `bounce: 0`) for most UI.
- Add bounce (**0.1–0.3**) only when the gesture itself carried momentum — a flick,
  a throw, a drag release. Overshoot on a menu that just faded in feels wrong;
  overshoot on a card you flicked feels right.

## Velocity handoff — the seam between drag and animation

When a gesture ends, the animation must continue at the finger's exact release
velocity, so there's no visible seam between dragging and animating. Track a short
position/timestamp history during the drag (not just the current point) so velocity
is available at release; pass it as the spring's initial velocity.

## Momentum projection — animate to where the gesture is going

Don't snap to the nearest boundary from the release point. Project the resting
position from velocity, then snap the nearest target to *that* projected point —
this is what makes a flick feel like it throws the element.

```js
// decelerationRate ≈ 0.998 for normal scroll feel; 0.99 for snappier
function project(initialVelocity /* px/s */, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}
const target = nearestSnapPoint(currentPosition + project(releaseVelocity));
```

Velocity-based dismissal threshold (drag-to-dismiss, swipe-to-delete):
`Math.abs(dragDistance) / elapsedMs > ~0.11` — a quick flick should dismiss
regardless of distance travelled. Note this is deliberately a whole-gesture
average (Vaul's heuristic), distinct from the recent-window release velocity the
spring handoff above uses — don't unify them.

## Rubber-banding — soft boundaries

At an edge, resist progressively instead of stopping hard. A hard stop reads as
frozen; continuous resistance reads as responsive.

```js
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
```

## Asymmetric timing — slow where the user decides, fast where the system responds

Pressing should be slow when it's deliberate (hold-to-confirm: 2s linear); release
should always be snappy (200ms ease-out). Applies broadly: slow on the phase the
user controls, fast on the phase the system controls.

## Spatial consistency

- Enter and exit along the same path — a panel that slides in from the right
  dismisses to the right.
- Anchor popovers/menus/tooltips to their trigger via `transform-origin` — modals
  are the exception, they stay centered.

## Translucent materials

Translucent surfaces (`backdrop-filter`): pair with `prefers-reduced-transparency: reduce` → raise background opacity and drop the blur. Reduced-motion behavior lives in `rules/accessibility.md`.
