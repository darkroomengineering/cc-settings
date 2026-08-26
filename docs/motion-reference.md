# Motion Reference

> Moved out of `rules/motion-physics.md` (Aug 2026 context diet): the rule keeps
> the physics and enforcement; this doc holds the recipes, debugging workflow,
> and naming reference. Adapted from emilkowalski/skills (MIT).

## Clip-path recipes

`clip-path: inset(top right bottom left)` is the third sanctioned animatable
property (alongside `transform`/`opacity`, see `rules/ui-skills.md`) — each value
"eats" into the element from that side.

- **Reveal** — `inset(0 100% 0 0)` → `inset(0 0 0 0)`, `ease-out`.
- **Hold-to-confirm** — overlay at `inset(0 100% 0 0)`; on `:active`, transition to
  `inset(0 0 0 0)` over 2s linear; on release, snap back with 200ms ease-out (pairs
  with the asymmetric-timing rule in `rules/motion-physics.md`).
- **Comparison slider** — clip the top image with `inset(0 <right>% 0 0)`, driving
  `<right>` from drag position. No extra DOM nodes and no layout work — though
  clip-path isn't compositor-guaranteed in every browser, so verify on target
  devices when it runs during a gesture.

## Debugging feel

When a value can't be judged from code alone (a crossfade, a spring's bounce, the
opacity/height balance in an entering list), don't guess:

- Play at 2–5× duration, or step frame-by-frame in the browser's animation
  inspector.
- Test drag/swipe gestures on a real device, not just the simulator.
- Review again the next day with fresh eyes — primed eyes pass defects that fresh
  eyes catch.

## Vocabulary reference

Reverse-lookup for naming an effect precisely — useful when writing a plan or
briefing another agent.

| Term | Meaning |
| --- | --- |
| Pop in | Element appears with a slight overshoot, like it bounces into place |
| Origin-aware animation | An element animates out of its trigger instead of its own center |
| Rubber-banding | Resistance and snap-back when dragging past a boundary |
| Morph | One shape smoothly turns into another (e.g. Dynamic Island) |
| Shared element transition | An element travels and transforms from one position into another |
| Stagger | Several items animate in one after another with a small delay between each |
| Crossfade | One element fades out as another fades in, in the same spot |
| Direction-aware transition | Content slides one way going forward, the opposite way going back |
| Perceptual duration | How long a spring feels finished, even though it keeps micro-settling underneath |
| Interruptible animation | An animation that can be smoothly redirected mid-flight instead of finishing first |
