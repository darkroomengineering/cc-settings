---
name: react-native
description: Expo mobile apps
---

# React Native Profile (Expo)

> Darkroom conventions for React Native apps with Expo SDK and Expo Router.

## Stack

- Expo SDK for managed features; leave managed workflow only when necessary.
- Expo Router with `(tabs)` / `(auth)` route groups, `components/{ui,forms,[feature]}`, and `lib/{api,hooks,stores,utils}`.
- Styling: NativeWind (`pt-safe` / `pb-safe` for safe areas) or `StyleSheet`; avoid inline style objects.
- Data and forms: TanStack Query, React Hook Form (`Controller` for `TextInput`).
- Images: `expo-image`. Animation and gestures: `react-native-reanimated` + `react-native-gesture-handler`, not the JS-thread `Animated` API. Native-feel animation bar: `rules/swift-animation.md`.
- Lists: `@shopify/flash-list` over `FlatList` for long lists.
- Secure storage: `expo-secure-store` for tokens, never `AsyncStorage`.
- Test on real devices, not only simulators.

## Gotchas

| Pitfall | Fix |
|---------|-----|
| `ScrollView` inside `FlatList` | Never nest scrollables; use `ListHeaderComponent` |
| Text not showing on Android | Wrap strings in `<Text>`; no raw strings |
| Keyboard covers input | `KeyboardAvoidingView` or `react-native-keyboard-aware-scroll-view` |
| Safe area overlap | `react-native-safe-area-context` (`SafeAreaView` with `edges`, or `useSafeAreaInsets`) |
| Touch target too small | Minimum 44x44 points |
| Platform shadows | iOS `shadow*` props, Android `elevation`; `Platform.select()` or `.ios.tsx` / `.android.tsx` files |

---

## Release & TestFlight

TestFlight reviews the **marketing version string**, not the build. The first
build under a new string goes through Beta App Review (hours to a day); every
later build under the same string clears in seconds.

1. **Freeze the version during a beta.** Keep `version` in `app.json` fixed and
   bump only the build number. Bump the version string once, when the next
   beta cycle starts.
2. **A shipped version is dead for beta.** Once a string reaches the App Store,
   Apple rejects that string and anything lower with "This version and prior
   versions are closed for beta review submission". Beta on 1.0.1+ after 1.0
   ships.
3. **Let EAS own build numbers.** In `eas.json` set
   `"appVersionSource": "remote"` at the top level and `"autoIncrement": true`
   on the build profile. Hand-managed numbers drift and block uploads.
4. **`eas submit --groups` only reaches internal groups.** To push every upload
   to a public external group, add an EAS Workflow `testflight` job:

   ```yaml
   # .eas/workflows/testflight.yml
   name: Distribute to Public Beta
   on:
     app_store_connect:
       build_upload:
         states: [complete]
   jobs:
     distribute:
       type: testflight
       params:
         asc_build_id: ${{ app_store_connect.build_upload.build.id }}
         external_groups: ['Public Beta']
         submit_beta_review: true
         changelog: Latest build
   ```

5. **One external group, named "Public Beta", with its public link on.** Keep
   one internal group for the owner and close collaborators. After a new build
   is approved, remove the older build so testers converge on one build.
6. **Deleting an App Store Connect user drops them from internal groups.** Add
   the new identity or have them rejoin via the public link. Removed app
   records are restorable from App Store Connect → Removed Apps.

Full note: team-knowledge `testflight-beta-versioning-and-eas-distribution`.

---

---

## Pre-Implementation Checklist

- [ ] Platform-specific code for iOS/Android differences
- [ ] Safe areas handled for all screens
- [ ] Handles offline/error states
- [ ] Beta uploads keep the version string frozen; `eas.json` uses remote `autoIncrement`; a `testflight` workflow distributes to the external group
