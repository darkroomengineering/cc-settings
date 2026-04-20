# cc-settings bootstrap for Windows — PowerShell mirror of setup.sh.
# All install logic lives in src\setup.ts. This file exists to:
#   1. Handle `iwr ... | iex` by cloning the repo if not already on disk.
#   2. Ensure Bun is installed.
#   3. exec `bun "$Repo\src\setup.ts" --source="$Repo" @Args`.
#
# Flags (forwarded to src\setup.ts):
#   --rollback[=TS]   restore newest backup (or a timestamp match)
#   --dry-run         print planned actions only
#   --ts-hooks        install with TS hook paths (also: $env:CC_USE_TS_HOOKS=1)
#   --help, -h

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/darkroomengineering/cc-settings.git"

# --- Resolve repo dir --------------------------------------------------------

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir -or -not (Test-Path $ScriptDir)) {
    # Invoked via `iwr ... | iex` — clone into a temp dir.
    $Clone = Join-Path $env:TEMP ("cc-settings-" + [System.Guid]::NewGuid().ToString("N"))
    Write-Host "Fetching cc-settings..."
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error "git is required for remote install. Install git or clone manually: git clone $RepoUrl"
        exit 1
    }
    git clone --depth 1 $RepoUrl $Clone | Out-Null
    & (Join-Path $Clone "setup.ps1") @Args
    exit $LASTEXITCODE
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
    # Idempotent dep install for the TS side.
    bun install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) { bun install 2>$null }

    $SetupTs = Join-Path $ScriptDir "src\setup.ts"
    bun $SetupTs "--source=$ScriptDir" @Args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
