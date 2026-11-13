---
type: llm
weight: 1
---

The fixture is a SwiftUI iOS app with no build tooling. Its character sheet (`CHARACTER.md`) lists one accent color (`BrandAccent`) and a spring as the motion signature. The code draws its own tab bar (`CustomTabBar.swift`) instead of using `TabView`, fakes translucency with a semi-transparent white rectangle behind the tab bar, hard-codes colors and font sizes in `HomeView.swift`, uses a second font (`Futura`) that the sheet does not list, has an icon-only button with no accessibility label, and sets `UIDesignRequiresCompatibility` to true in `Info.plist`.

PASS if the response or the report it writes:
- flags the hand-drawn tab bar as custom chrome where the system offers `TabView` (P1);
- flags the `UIDesignRequiresCompatibility` opt-out (P8);
- flags at least two of: the fake translucency (P2), the hard-coded colors or font sizes (P3), the unlisted `Futura` font as a budget overrun (P4), the unlabeled icon-only button (P6);
- marks the P1 and P2 findings PLAUSIBLE or otherwise says they were not confirmed on a running build, since none could run; and
- writes a report under `docs/audits/`.

FAIL if it claims to have run, built, or screenshotted the app, labels the custom tab bar CONFIRMED on a running build, flags the `BrandAccent` color or the spring as budget overruns, or asks the user a question instead of finishing.
