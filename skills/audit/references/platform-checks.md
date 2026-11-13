# Platform mode: checks

Read by `/audit platform`. The mode rides the Shared Contract and the finding contract in `audit-contract.md`. It is read-only on source. Finding IDs are `N` plus the check number and a sequence, so `N3-2` is the second finding for P3. In Full mode the prefix is `N`.

**Role additions.** A user who also runs the platform's own apps and notices what is out of place. A platform engineer who knows which system component replaces each custom view.

**Scope.** All UI code for the platforms the app ships on, its asset catalog or resources (icon, accent, fonts), and its character sheet. Load the matching rule in full and treat its bullets as the checklist: `rules/apple-design.md` for Swift, `rules/windows-design.md` for XAML and C#, `rules/android-design.md` for Kotlin Compose. An app that ships on several platforms is audited per platform, with one finding list. In standalone Codex, the `rules/` and `profiles/` paths in this file are under `$CODEX_HOME/darkroom/source/` (`CODEX_HOME` defaults to `~/.codex`).

## Checks

1. **P1 Custom chrome.** Navigation, sidebar, toolbar, title bar, tab bar, window background, or a sheet or popover background drawn by the app where the system offers the component. This check catches an app that looks like the odd one out next to the platform's own apps.
2. **P2 Hand-built materials.** Fake blur or translucency, glass in the content layer, more than one window backdrop, Acrylic as a window background.
3. **P3 Literals the theme owns.** Hard-coded colors, font sizes, corner radii, spacing, or durations in view code instead of system styles, theme resources, or `MaterialTheme`.
4. **P4 Budget overruns.** Any accent, font, motion, sound, or interaction that is not one of the seven character-budget items in `profiles/native-apps.md`, or that the character sheet does not list.
5. **P5 Settings ignored.** Reduce Motion, Reduce Transparency, Increase Contrast, high contrast themes, text scaling, light and dark, window resizing.
6. **P6 Accessibility floor.** Icon-only controls with no label, touch or pointer targets under the platform's minimum, color as the only signal.
7. **P7 App icon and assets.** An icon outside the platform's layered or adaptive format, or one with effects the system draws baked in.
8. **P8 Escape hatches.** A compatibility key or flag that opts out of the current look (`UIDesignRequiresCompatibility` on Apple), a pinned older component library, a custom control with a system equivalent.

## Method

1. Read the character sheet first. A deviation the sheet records and the user approved goes in the considered-and-rejected ledger with the sheet line cited. A deviation the sheet does not mention is a finding.
2. Confirm P1 and P2 on a running build, with screenshots beside the platform's own apps. From source alone they are PLAUSIBLE.
3. When a rule's source note marks a claim as unconfirmed or version-dependent, check the project's pinned versions before reporting it.

## Map

Per platform, the system components in use against the custom views that stand in for one, with counts.

## Extra output

A verdict table per platform (P1 to P8: pass, finding ID, or not applicable), and the list of character-budget items the code spends that the sheet does not name.
