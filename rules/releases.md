---
paths:
  - ".github/workflows/**"
  - "ship.json"
  - "**/fastlane/**"
---

# Release Credentials

> Native releases go through `ship` (Shipit). Start a new native app with one `ship.json` and the [Shipit Apple build workflow](https://github.com/darkroomengineering/shipit#build-a-new-apple-app-in-ci).

- **Nobody sets up credentials on their own machine to ship.** A merge to `main` releases from CI on the studio Mac release runner (`runs-on: ${{ fromJSON(vars.MAC_RUNNER) }}`). When a teammate asks how to get a key so they can release, the answer is to merge, not to copy the key.
- **Build previews on GitHub-hosted runners.** Upload an unsigned artifact without release credentials. Run reviewed builds on darky-body only through a runner group restricted to approved workflow refs and isolated from release credentials.
- **Scope credentials to the release lane.** The release job declares `environment: release`, restricted to `main`. Keep app-specific credentials there. Apple store lanes can use the selected-repository App Store Connect org secrets provisioned by `ship setup`. Keep access narrow and reference those secrets only in the protected release job.
- **The maintainer holds the master copies.** They sit in a vault on the release runner, readable by its admin account and not by CI jobs, with a backup in the team's 1Password. Adding or rotating a credential means updating the vault and reloading the environment from it; ask the maintainer rather than generating a replacement.
- **Never read or print a secret value.** Load a file with `gh secret set NAME --env release -R org/repo < file`. In a job, write each credential to `$RUNNER_TEMP`, pass its path through an env var, and delete it in an `if: always()` step.
- **Fail with the name of what is missing:** `[[ -n "$ASC_KEY_P8" ]] || { echo "::error::missing secret ASC_KEY_P8"; exit 1; }`.
- **Never replace an update signing key, feed URL or bundle ID** (Sparkle EdDSA, Tauri minisign, Android upload key). Installed copies trust the old one and stop updating. A lost Developer ID certificate can be reissued; a lost update key cannot.

| Secret | What it is | How `ship` finds it |
|---|---|---|
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | App Store Connect team API key | `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `KEY_PATH` pointing at the written `.p8` |
| `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID certificate as a `.p12` | imported into a temporary keychain by the workflow |
| `SPARKLE_PRIVATE_KEY` | Sparkle EdDSA update key | read by the workflow's appcast step |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_SIGNING_PROPERTIES` | Play upload keystore and its signing properties | the app's Gradle build reads the properties file from a path the job sets |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Play service account | `PLAY_KEY_PATH` pointing at the written `.json` |

## How each app ships

| App | Ships through | Notes |
|---|---|---|
| Programa, Metricae, Browsee | CI on the studio Mac runner | |
| Mesinyer | CI on the studio Mac runner | Mac, plus a Windows lane |
| NoCam | CI on the studio Mac runner | iOS TestFlight and Google Play |
| Wavecast | CI on the studio Mac runner | iOS TestFlight |
| NoteTaker | CI on the studio Mac runner | `notetaker-release.yml` in the backbone repo; dispatch it with dry-run first |
| codigo | CI on the studio Mac runner, being added | Mac App Store |
| Lazytrack, Atrium | not ready to release | no app CI yet |
| Pokefolio | not ready to release | Expo app with a `ship.json`; no release workflow yet |
| Websites | Vercel's git integration on merge to `main` | |
| theca, curiosus-backend | Railway | |

- **To ship a native app, merge to `main`** or dispatch its release workflow, dry-run first. The job reads credentials from the `release` environment, so they never live on anyone's Mac.
- **Keep websites and services off the studio Mac runner.** It is CPU-bound; Vercel and Railway run their own builds.
