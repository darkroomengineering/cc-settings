# cc-settings bootstrap for Windows - PowerShell mirror of setup.sh.
# All install logic lives in src\setup.ts. This file exists to:
#   1. Handle `irm ... | iex` by cloning the repo if not already on disk.
#   2. Ensure Bun is installed.
#   3. exec `bun "$Repo\src\setup.ts" --source="$Repo" @Args`.
#
# Remote one-liner (default full install; clone the repo to pass flags):
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
#
# Flags (forwarded to src\setup.ts):
#   --light           light tier: raw CC + statusline + share-learning only
#   --rollback[=TS]   restore newest backup (or a timestamp match)
#   --dry-run         print planned actions only
#   --status          print installed vs packaged version info
#   --migrate-only    backup + settings merge + sentinel; skip file copy
#   --interactive     prompt on settings.json conflicts (also: $env:CC_INTERACTIVE=1)
#   --help, -h

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/darkroomengineering/cc-settings.git"

# --- Resolve repo dir --------------------------------------------------------

# Under `irm | iex` there is no script file, so MyCommand.Path is $null -
# guard before Split-Path (binding $null to -Path is a terminating error).
$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $null }
if (-not $ScriptDir -or -not (Test-Path $ScriptDir)) {
    # Invoked via `irm ... | iex` - clone into a temp dir.
    $Clone = Join-Path ([System.IO.Path]::GetTempPath()) ("cc-settings-" + [System.Guid]::NewGuid().ToString("N"))
    Write-Host "Fetching cc-settings..."
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error "git is required for remote install. Install git or clone manually: git clone $RepoUrl"
        exit 1
    }
    # --quiet keeps git off stderr: under Windows PowerShell 5.1 with
    # ErrorActionPreference=Stop, redirected stderr becomes terminating errors.
    git clone --quiet --depth 1 $RepoUrl $Clone
    if ($LASTEXITCODE -ne 0) {
        Write-Error "git clone failed. Clone manually: git clone $RepoUrl"
        exit 1
    }
    try {
        & (Join-Path $Clone "setup.ps1") @Args
        exit $LASTEXITCODE
    }
    finally {
        Remove-Item -Recurse -Force $Clone -ErrorAction SilentlyContinue
    }
}

# --- Ensure Bun --------------------------------------------------------------

function Ensure-Bun {
    if (Get-Command bun -ErrorAction SilentlyContinue) { return }
    Write-Host "Bun not found - installing via https://bun.sh/install..."
    try {
        Invoke-RestMethod bun.sh/install.ps1 | Invoke-Expression
    }
    catch {
        Write-Error "Bun install failed. Install manually: https://bun.sh/docs/installation"
        exit 1
    }
    # The installer adds ~/.bun/bin to PATH for future shells; add it now too.
    $BunBin = Join-Path $HOME ".bun\bin"
    if (Test-Path $BunBin) {
        $env:PATH = "$BunBin;$env:PATH"
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Error "bun install completed but 'bun' is not on PATH. Re-run from a new shell."
        exit 1
    }
}

Ensure-Bun

# --- Delegate to src\setup.ts ------------------------------------------------

Push-Location $ScriptDir
try {
    # Idempotent dep install for the TS side. Output stays visible: silencing
    # via `2>$null` turns native stderr into terminating errors under Windows
    # PowerShell 5.1 with ErrorActionPreference=Stop.
    bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { bun install }

    $SetupTs = Join-Path $ScriptDir "src\setup.ts"
    bun $SetupTs "--source=$ScriptDir" @Args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
