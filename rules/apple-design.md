---
paths:
  - "**/*.swift"
---

# Apple Platform Design

Applies to UI code in iOS, iPadOS, and macOS apps (SwiftUI, UIKit, AppKit). Use the
system's navigation, controls, materials, type, and spacing, and spend an app's
character only in content and moments. The stack-neutral decision and the
character sheet are in `profiles/native-apps.md`. Animation frame-rate rules are
in `rules/swift-animation.md`.

> Sources, read 2026-11-13: Apple HIG [Materials](https://developer.apple.com/design/human-interface-guidelines/materials),
> [Color](https://developer.apple.com/design/human-interface-guidelines/color),
> [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars),
> [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars),
> [Typography](https://developer.apple.com/design/human-interface-guidelines/typography),
> [Motion](https://developer.apple.com/design/human-interface-guidelines/motion),
> [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility),
> [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons);
> [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass);
> `View.glassEffect(_:in:)` is listed as introduced in 26.0 on iOS, iPadOS, and macOS in Apple's SwiftUI documentation.

## Chrome comes from the system

- Build with standard SwiftUI, UIKit, and AppKit components. They pick up Liquid
  Glass when the app is rebuilt with the latest SDK; do not hard-code their layout
  metrics.
- Remove custom backgrounds and effects from `NavigationStack`, `NavigationSplitView`,
  `WindowStyle.titleBar`, `toolbar(content:)`, `UINavigationBar`, `UITabBar`,
  `UIToolbar`, `UISplitViewController`, `NSToolbar`, and `NSSplitView`. Let the
  system draw them.
- Do not put Liquid Glass in the content layer. App backgrounds and content use
  standard materials. The one exception is a transient control such as a slider or
  toggle, which the system already draws as glass while it is active.
- Use `glassEffect(_:in:)` only on the few most important custom controls. Group
  neighbouring custom glass in a `GlassEffectContainer`. Prefer the `.glass` and
  `.glassProminent` button styles to hand-built glass.
- Use the clear glass variant only over visually rich media. If that media is
  bright, add a dark dimming layer of about 35% opacity.
- A sidebar or inspector that should show content running under it uses
  `backgroundExtensionEffect()`. A custom bar over scrolling content registers with
  `safeAreaBar(edge:alignment:spacing:content:)`; control the edge blur with
  `scrollEdgeEffectStyle(_:for:)`.
- Support arbitrary window sizes with a split view, and honor safe areas and layout
  guides. Remove custom visual-effect backgrounds from sheets and popovers.
- Keeping the pre-26 look with `UIDesignRequiresCompatibility` is a deviation from
  this standard. Do not add it without the user's sign-off.

## Navigation and toolbars

- A sidebar shows at most two levels of hierarchy. Put no critical action at its
  bottom edge. Let people hide it; do not hide it by default.
- Sidebar icons follow the user's accent color unless a fixed color carries meaning.
- Toolbars hold at most three groups. Mark one primary action `.prominent` and put
  it on the trailing side. Do not add toolbar backgrounds, tinted controls, or a
  manual overflow menu.
- On macOS every toolbar item is also a menu bar command, because people can hide or
  customize the toolbar. Give common commands keyboard shortcuts.
- Use the standard Back and Close symbols, not text labels. Title a window with its
  content, not the app name, in under 15 characters.
- Every icon-only control has an accessibility label.

## Type, color, shape

- Use the system font through the built-in text styles. Do not embed system fonts.
  macOS body text is 13 pt (10 pt minimum); iOS and iPadOS 17 pt (11 pt minimum).
  Avoid ultralight, thin, and light weights.
- A custom font is a character-budget item. It must stay legible and support
  Dynamic Type and Bold Text where the platform has them.
- Use semantic and system colors through `Color` and its platform equivalents. Do
  not hard-code system color values and do not repurpose a semantic color (a
  separator color as text, a secondary label color as a background).
- A custom color ships light, dark, and increased-contrast variants.
- Color is never the only signal for state, interactivity, or error. Pair it with a
  label or shape.
- Tint glass only to emphasize a primary action, on the background and not on the
  symbol or text, and never on several neighbouring controls.
- The system accent wins. Controls, selection, and sidebar icons use the user's
  accent. On macOS the app accent color applies only while the user's accent setting
  is multicolor. The app's own accent appears only in its branded touches, inside the
  character budget.
- Prefer concentric corners (`ConcentricRectangle`, `Shape.rect(corners:isUniform:)`)
  over fixed radii when a shape sits inside a bar or window.

## Motion and accessibility

- Add motion for a reason. Avoid it on frequent interactions, never make people wait
  for it to finish, and let them cancel it.
- With Reduce Motion on, cut automatic and repetitive animation, including zooming,
  scaling, and peripheral motion.
- Default control size is 44 x 44 pt on iOS and iPadOS (28 pt minimum) and 28 x 28 pt
  on macOS (20 pt minimum). Design to the default.
- Test with Reduce Transparency, Increase Contrast, Reduce Motion, and the largest
  Dynamic Type size before calling UI done.

## App icon

- Ship a layered Icon Composer file with square, unmasked layers and a simple
  background. Do not bake in highlights, drop shadows, bevels, blur, or glow; the
  system draws them.
- Keep the icon's core features the same across default, dark, clear, and tinted
  appearances.
