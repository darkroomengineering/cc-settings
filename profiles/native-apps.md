---
name: native-apps
description: Native apps on iOS, macOS, Windows, and Android that follow each platform's design guidelines
---

# Native Apps Profile

> Darkroom's design standard for apps that ship on a platform's own UI framework.

## Posture

Every app follows the human interface guidelines of the platform it ships on and is
written in that platform's native code. Native is the floor. Character is a small,
fixed budget spent in content and moments, never in custom chrome.

| Platform | Guidelines | Native stack | Rule loaded for it |
|---|---|---|---|
| iOS, iPadOS, macOS | Apple HIG, Liquid Glass | SwiftUI, with AppKit and UIKit where SwiftUI stops | `rules/apple-design.md` |
| Windows | Fluent 2 as applied in Windows app design | WinUI 3 in XAML and C# on the Windows App SDK | `rules/windows-design.md` |
| Android | Material 3 | Jetpack Compose in Kotlin | `rules/android-design.md` |

## The floor

All chrome comes from the system: navigation, sidebars, toolbars, controls,
materials (Liquid Glass on Apple platforms, Mica and Acrylic on Windows, Material 3
on Android), the type scale, spacing, corner radii, default motion, accessibility
settings, and system integrations. When the system offers a component, use it.
When it does not, the gap goes to the user as a question, not into a custom widget.

## The character budget

Each app spends these seven items and nothing else. The app writes them down on one
page, the character sheet, before building UI:

1. One accent color.
2. One motion signature.
3. The app icon.
4. Empty states and illustration.
5. Copy voice.
6. Optional sound.
7. One signature interaction.

A custom font, a custom toolbar, a hand-drawn material, or a second accent color is
not on the list. It needs the user's sign-off and a line on the sheet.

## Working rules

- Read the character sheet before touching UI. If the app has none, ask for one.
- Check each platform rule's own checklist while building, and run `/audit platform`
  before a release.
- Character shows up in content: the empty state, the first-run moment, the copy,
  the one interaction. If a change to chrome is needed to express it, the change is
  wrong.
- Respect the system accessibility settings: Reduce Motion, Reduce Transparency,
  Increase Contrast, and text size.
- The system accent (the accent color on macOS, `SystemAccentColor` on Windows,
  dynamic color on Android) is the default. Whether the app's one accent overrides it
  on a platform is decided on the sheet. On macOS a user-chosen accent replaces the
  app's regardless.

The decision, the sheet template, and a worked example are in the team-knowledge
note `native-apps-follow-platform-guidelines`.
