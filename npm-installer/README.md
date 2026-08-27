# cc-settings installer

Installs [Darkroom Engineering's Claude Code + Codex configuration](https://github.com/darkroomengineering/cc-settings).

```bash
npx cc-settings
```

Flags are forwarded to the installer — every `setup.sh` flag works:

```bash
npx cc-settings --light --auto-update=on
npx cc-settings --dry-run
npx cc-settings --status
```

`bunx cc-settings` works the same way. On Windows, the same command runs the
PowerShell installer.

## What this package is

A downloader, nothing more. It fetches the official bootstrap script over
HTTPS and runs it; the bootstrap then clones the cc-settings repository from
its pinned GitHub origin and installs from that clone. The configuration is
never distributed through npm — this package cannot change what gets
installed, only how the bootstrap is fetched.

Requirements: Node 18+, git, and bash (macOS/Linux) or PowerShell (Windows).
The bootstrap installs [Bun](https://bun.sh) if it is missing.

## Publishing (maintainers)

The stub is versioned independently of cc-settings — it only changes when the
downloader itself changes, not per cc-settings release.

```bash
cd npm-installer
npm publish
```
