---
paths:
  - "**/*.kt"
---

# Android Platform Design

Applies to UI code in Android apps written with Jetpack Compose and Material 3. Use
the system's theme, components, type scale, shapes, and insets, and spend an app's
character only in content and moments. The stack-neutral decision and the character
sheet are in `profiles/native-apps.md`.

> Sources, read 2026-11-13: developer.android.com
> [Material 3 in Compose](https://developer.android.com/develop/ui/compose/designsystems/material3),
> [Edge-to-edge](https://developer.android.com/develop/ui/views/layout/edge-to-edge),
> [Insets in Compose](https://developer.android.com/develop/ui/compose/system/insets),
> [Accessibility API defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults),
> [Adaptive layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive),
> [Compose Material 3 release notes](https://developer.android.com/jetpack/androidx/releases/compose-material3),
> and the Compose Material 3 API reference for `MaterialExpressiveTheme` and
> `MotionScheme`. Not read: m3.material.io, which returned no page text.

## Theme

- Wrap the app in `MaterialTheme(colorScheme, typography, shapes)`. Every color,
  text style, and corner in composables comes from `MaterialTheme.colorScheme`,
  `.typography`, and `.shapes`. A literal `Color(0x...)`, `sp` font size, or
  `RoundedCornerShape` in a composable is a finding; literals belong in the theme
  definition.
- Material Expressive is not the floor. `MaterialExpressiveTheme` (with its
  `motionScheme` parameter) was added in `material3` 1.5.0-beta02. On 2026-11-13
  the release notes listed 1.4.0 as the stable release and 1.5.0-rc01 as the newest
  build. Use it only when the project pins a version that has it, and check each
  expressive symbol for an `ExperimentalMaterial3ExpressiveApi` opt-in before
  relying on it.
- Dynamic color wins. On Android 12 and above, use `dynamicLightColorScheme` and
  `dynamicDarkColorScheme` for the theme, so controls take the user's palette. Use a
  custom `lightColorScheme` and `darkColorScheme` only below Android 12. The app's
  own accent appears only in its branded touches (content, empty states,
  illustration), inside the character budget.
- Pair color roles as designed: `onPrimary` on `primary`, `onPrimaryContainer` on
  `primaryContainer`, and so on. Mismatched pairs (a tertiary container with primary
  container text) fail contrast.
- Follow `isSystemInDarkTheme()` for light and dark.
- Express elevation with `Surface` tonal elevation, not hand-drawn shadows.

## Components and layout

- Use Material 3 components with their default semantics, ripple, and overscroll.
  Do not replace the system ripple or stretch overscroll.
- Use `NavigationBar` for compact windows with at most five destinations,
  `NavigationRail` for small-to-medium tablets and phones in landscape, and a
  navigation drawer for medium-to-large tablets. Prefer `NavigationSuiteScaffold`,
  which switches between the bar and the rail by window size class.
- Choose layouts from `currentWindowAdaptiveInfo().windowSizeClass` (compact,
  medium, expanded), not from device type. Use `ListDetailPaneScaffold` and
  `SupportingPaneScaffold` for two-pane layouts.
- Apps run in resizable windows. Keep state across configuration changes in a
  `ViewModel` or saved instance state.
- Draw edge-to-edge. Apps targeting SDK 35 are edge-to-edge on Android 15 and
  higher; call `enableEdgeToEdge()` for earlier versions. Let the top and bottom
  app bars extend behind the system bars, and pad scrolling content with
  `Scaffold`'s `innerPadding` or `WindowInsets.safeDrawing` so nothing tappable sits
  under system UI.

## Type

- Use the five groups and three sizes of `MaterialTheme.typography` (display,
  headline, title, body, label; large, medium, small). Define only the subset the
  app needs, in the theme.
- A custom `fontFamily` is a character-budget item, set once per text style in the
  theme `Typography`.

## Accessibility

- Every interactive element is at least 48dp. Material components add the padding
  themselves when they take an action. For a smaller visible element, use
  `Modifier.minimumInteractiveComponentSize()` before any size modifier.
- Every `Icon` and `Image` has a localized `contentDescription` from
  `stringResource`, or `null` when it is purely decorative.
- Use `clickable` and `toggleable` on the parent row and set the child checkbox or
  switch handler to `null`, so a row reads as one control.
- Test with `@PreviewFontScale`, `@PreviewLightDark`, and `@PreviewScreenSizes`.
