---
paths:
  - ".github/workflows/**"
  - "ship.json"
  - "**/fastlane/**"
---

# Release Credentials

> Releases go through `ship` (shipit). This file covers where its signing and store credentials live and how a workflow reaches them.

- **Nobody sets up credentials on their own machine to ship.** A merge to `main` releases from CI on the studio Mac release runner (`runs-on: ${{ fromJSON(vars.MAC_RUNNER) }}`). When a teammate asks how to get a key so they can release, the answer is to merge, not to copy the key.
- **Credentials live in the repo's `release` environment.** It only deploys from `main`. The release job declares `environment: release` and reads `secrets.*` from it. Do not add signing or store secrets at repo level or as org secrets visible to all repositories; a pull request job can read those.
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
