---
paths:
  - "**/*.xaml"
  - "**/*.xaml.cs"
---

# Windows Platform Design

Applies to WinUI 3 apps written in XAML and C# on the Windows App SDK. Use the
system's controls, materials, type ramp, geometry, and theme resources, and spend
an app's character only in content and moments. The stack-neutral decision and the
character sheet are in `profiles/native-apps.md`.

> Sources, read 2026-11-13, all on learn.microsoft.com under `/windows/apps/`:
> [Materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials),
> [Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica),
> [System backdrops](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops),
> [Title bar](https://learn.microsoft.com/en-us/windows/apps/develop/title-bar),
> [Geometry](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry),
> [Typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography),
> [Color](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color),
> [Theming](https://learn.microsoft.com/en-us/windows/apps/develop/ui/theming),
> [Motion](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/motion),
> [Page transitions](https://learn.microsoft.com/en-us/windows/apps/develop/motion/page-transitions).
> Those pages describe how Fluent 2 is applied to Windows apps.

## Materials

- Set the window material once, with `Window.SystemBackdrop`. Use `MicaBackdrop` for
  a long-lived app window and `MicaBackdrop` with `Kind="BaseAlt"` for a window with
  a tabbed title bar. `Window.SystemBackdrop` is the recommended path from Windows
  App SDK 1.3.
- Use Acrylic (`DesktopAcrylicBackdrop`) only on transient, light-dismiss surfaces
  such as flyouts and context menus, never as the window background.
- Set every layer between the window and the content to transparent where Mica
  should show through. A backdrop set on an element is not visible unless all layers
  above it are transparent.
- Give the content layer `LayerFillColorDefaultBrush`. On a Mica Alt window, give
  the commanding layer (menus, navigation) `LayerOnMicaBaseAltFillColorDefaultBrush`.
- Do not hand-draw a fake material. Mica falls back to a solid color when
  transparency is off, in Battery Saver, on low-end hardware, when the window is
  inactive, and on Windows below build 22000; that behavior is part of the standard.
- A backdrop on one bounded region (a card, a panel) uses `SystemBackdropElement`,
  which needs Windows App SDK 2.0 or later. Do not use it to restyle chrome.

## Title bar and navigation

- Extend content into the title bar so the material reaches the top edge. Set
  `ExtendsContentIntoTitleBar` in code, in the window constructor, not in XAML; the
  XAML attribute errors and a late set flashes the default title bar.
- Windows App SDK 1.7 adds a `TitleBar` control for this. Otherwise mark the drag
  region with `SetTitleBar`.
- Use `NavigationView` for left or top navigation. It supplies the content layer and
  the top-nav slide transition, and a `Frame` plays its page transition by default.

## Geometry

- Corner radius comes from `ControlCornerRadius` (4px, in-page controls and bars)
  and `OverlayCornerRadius` (8px, windows, flyouts, dialogs). Do not hard-code
  radii on standard controls.
- Touching elements inside one container (the two halves of a split button) and
  maximized or snapped windows have square corners.

## Type

- Use one font, Segoe UI Variable, which the XAML common controls select by default.
- Use the built-in type ramp styles, not hand-set sizes: Caption 12/16, Body 14/20,
  Body Strong 14/20, Body Large 18/24, Subtitle 20/28, Title 28/36, Title Large
  40/52, Display 68/92 (effective pixels). In XAML, `BodyTextBlockStyle` and
  `BodyStrongTextBlockStyle` are the body styles.
- Use Semibold for emphasis. Bold and Italic are not in the type ramp.
- Use sentence case for all UI text, including titles. Minimum sizes are 12px
  Regular and 14px Semibold.
- Align left by default. Keep lines to 50 to 60 characters.

## Color and theme

- Use `ThemeResource` brushes, never hard-coded colors, in control templates and
  styles. High contrast themes override a requested theme, so test them.
- Leave `RequestedTheme` unset so the app follows the user's light or dark choice,
  and test both.
- The user's `SystemAccentColor` wins. Do not override it in `App.xaml`; controls
  use the user's accent. The app's own accent appears only in its branded touches
  (content, empty states, illustration), inside the character budget. Check text
  and background contrast against the user's accent and its `SystemAccentColorLight1..3`
  and `Dark1..3` shades, since you do not choose it.
- Use accent sparingly, to emphasize an important element or show interactive
  state. Choose one color for "this is interactive".
- Never use red against green as the only difference between two states.

## Motion

- Avoid custom animation. Use `EntranceNavigationTransitionInfo` (top of a stack,
  such as switching tabs), `DrillInNavigationTransitionInfo` (going deeper),
  `SlideNavigationTransitionInfo` (sibling pages), connected animations, and
  animated icons.
- Use `SuppressNavigationTransitionInfo` only when you supply a replacement
  transition.
- When a custom animation is unavoidable, use the Windows timings: 167, 250, or
  333 ms for position, scale, and rotation; 167 ms for exits, always with a fade;
  83 ms linear for opacity-only fades.
