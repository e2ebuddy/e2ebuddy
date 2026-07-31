# e2ebuddy local CLI launcher.
# Usage: .\run.ps1 [setup|cli|demo|help] ...

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = '',

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Write-Log([string]$Message) {
  Write-Host "==> $Message"
}

function Write-WarnMsg([string]$Message) {
  Write-Warning $Message
}

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

function Show-Usage {
  @'
e2ebuddy local runner

CLI + local disk only. No database or queue service is required.

Usage:
  .\run.ps1                 Setup (if needed) and show CLI usage
  .\run.ps1 setup           Install deps, Playwright Chromium, build, prepare .env
  .\run.ps1 cli <args...>   Run acceptance CLI
  .\run.ps1 demo            Start local defect fixture (http://127.0.0.1:4173)
  .\run.ps1 help            Show this help

CLI examples:
  .\run.ps1 cli executor-demo https://example.com
  .\run.ps1 cli explore https://example.com --brief "demo site"
  .\run.ps1 cli test https://example.com --brief "demo site"

  # Local fixture acceptance
  .\run.ps1 demo
  $env:E2EBUDDY_ALLOW_PRIVATE_TARGETS = "true"
  $env:E2EBUDDY_TEST_USERNAME = "demo@e2ebuddy.dev"
  $env:E2EBUDDY_TEST_PASSWORD = "DemoPass123!"
  .\run.ps1 cli test http://127.0.0.1:4173/demo/login --brief "Users can sign in..."

Requirements:
  - Node.js >= 20
  - pnpm (via corepack)
  - AI_API_KEY (or ANTHROPIC_*) in .env for explore / test
  - Screenshots stored under .\storage (local disk)
'@ | Write-Host
}

function Get-EnvFileValue([string]$Name) {
  if (-not (Test-Path .env)) { return '' }
  $line = Get-Content .env | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return '' }
  $value = $line.Substring($Name.Length + 1).Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Set-EnvFileValue([string]$Name, [string]$Value) {
  $lines = @()
  if (Test-Path .env) {
    $lines = @(Get-Content .env)
  }
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Name))=") {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $found) {
    $updated = @($updated) + @("$Name=$Value")
  }
  $updated | Set-Content -Path .env -Encoding utf8
}

function Import-DotEnv {
  if (-not (Test-Path .env)) { return }
  Get-Content .env | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    Set-Item -Path "Env:$name" -Value $value
  }
  # Always use local storage for this launcher.
  $env:STORAGE_DRIVER = 'local'
  if (-not $env:STORAGE_DIR) { $env:STORAGE_DIR = './storage' }
}

function Ensure-EnvFile {
  if (-not (Test-Path .env)) {
    if (Test-Path .env.example) {
      Copy-Item .env.example .env
      Write-Log 'Created .env from .env.example'
    } else {
      Fail '.env missing and .env.example not found'
    }
  }

  Set-EnvFileValue 'STORAGE_DRIVER' 'local'
  if ([string]::IsNullOrWhiteSpace((Get-EnvFileValue 'STORAGE_DIR'))) {
    Set-EnvFileValue 'STORAGE_DIR' './storage'
  }

  $enc = Get-EnvFileValue 'CREDENTIALS_ENCRYPTION_KEY'
  if ([string]::IsNullOrWhiteSpace($enc)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-EnvFileValue 'CREDENTIALS_ENCRYPTION_KEY' ([Convert]::ToBase64String($bytes))
    Write-Log 'Generated CREDENTIALS_ENCRYPTION_KEY in .env'
  }

  Import-DotEnv
}

function Require-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Node.js is required (need >= 20)'
  }
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -lt 20) {
    Fail "Node.js >= 20 required (found $(node -v))"
  }
}

function Ensure-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return }
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    Write-Log 'Enabling pnpm via corepack'
    corepack enable
    corepack prepare pnpm@11.8.0 --activate
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail 'pnpm not found; install pnpm or enable corepack'
  }
}

function Warn-AiKey {
  $key = Get-EnvFileValue 'AI_API_KEY'
  $anthropic = Get-EnvFileValue 'ANTHROPIC_API_KEY'
  if ([string]::IsNullOrWhiteSpace($key) -and [string]::IsNullOrWhiteSpace($anthropic)) {
    Write-WarnMsg 'AI_API_KEY (or ANTHROPIC_API_KEY) is empty — explore/test need a model API key in .env'
  }
}

function Ensure-Built {
  if (-not (Test-Path 'packages/cli/dist/cli.js')) {
    Write-Log 'Build artifacts missing; building CLI stack'
    pnpm build --filter=e2ebuddy...
  }
}

function Invoke-Setup {
  Require-Node
  Ensure-Pnpm
  Ensure-EnvFile
  Warn-AiKey

  Write-Log 'Installing dependencies'
  pnpm install

  Write-Log 'Installing Playwright Chromium'
  pnpm -F executor exec playwright install chromium

  Write-Log 'Building packages (CLI path only)'
  pnpm build --filter=e2ebuddy...

  $storageDir = if ($env:STORAGE_DIR) { $env:STORAGE_DIR } else { './storage' }
  New-Item -ItemType Directory -Force -Path $storageDir | Out-Null

  Write-Log 'Setup complete (no middleware required)'
  Write-Host ''
  Write-Host 'Ready. Examples:'
  Write-Host '  .\run.ps1 cli executor-demo https://example.com'
  Write-Host '  .\run.ps1 cli explore https://example.com --brief "demo site"'
  Write-Host '  .\run.ps1 cli test https://example.com --brief "demo site"'
  Write-Host '  .\run.ps1 demo'
}

function Invoke-Cli {
  Require-Node
  Ensure-Pnpm
  Ensure-EnvFile
  Warn-AiKey
  Import-DotEnv
  Ensure-Built

  $storageDir = if ($env:STORAGE_DIR) { $env:STORAGE_DIR } else { './storage' }
  New-Item -ItemType Directory -Force -Path $storageDir | Out-Null

  if (-not $Rest -or $Rest.Count -eq 0) {
    Write-Host @'
Usage:
  .\run.ps1 cli executor-demo <url>
  .\run.ps1 cli explore <url> [--brief "..."]
  .\run.ps1 cli test <url> [--brief "..."]
'@
    exit 1
  }

  & pnpm -F e2ebuddy cli @Rest
}

function Invoke-Demo {
  Require-Node
  Ensure-Pnpm
  Ensure-EnvFile
  Import-DotEnv

  Write-Log 'Building fixture and starting demo at http://127.0.0.1:4173'
  pnpm -F fixture build
  Write-Log 'Demo login: demo@e2ebuddy.dev / DemoPass123!'
  Write-Log 'Then set E2EBUDDY_ALLOW_PRIVATE_TARGETS=true and run .\run.ps1 cli test http://127.0.0.1:4173/demo/login --brief "..."'
  pnpm -F fixture start
}

function Invoke-Default {
  Require-Node
  Ensure-Pnpm
  Ensure-EnvFile
  Warn-AiKey

  if (-not (Test-Path 'node_modules') -or -not (Test-Path 'packages/cli/dist/cli.js')) {
    Write-Log 'First-time or incomplete install — running setup'
    Invoke-Setup
    return
  }

  Import-DotEnv
  $storageDir = if ($env:STORAGE_DIR) { $env:STORAGE_DIR } else { './storage' }
  New-Item -ItemType Directory -Force -Path $storageDir | Out-Null

  Write-Log 'e2ebuddy is ready (local CLI, no middleware)'
  Write-Host ''
  Write-Host "  storage: $storageDir"
  $ai = Get-EnvFileValue 'AI_API_KEY'
  $anthropic = Get-EnvFileValue 'ANTHROPIC_API_KEY'
  if ([string]::IsNullOrWhiteSpace($ai) -and [string]::IsNullOrWhiteSpace($anthropic)) {
    Write-Host '  AI key:  MISSING — edit .env'
  } else {
    Write-Host '  AI key:  configured'
  }
  Write-Host ''
  Show-Usage
}

switch ($Command.ToLowerInvariant()) {
  '' { Invoke-Default }
  'setup' { Invoke-Setup }
  'cli' { Invoke-Cli }
  'demo' { Invoke-Demo }
  'help' { Show-Usage }
  '-h' { Show-Usage }
  '--help' { Show-Usage }
  'web' {
    Fail @'
Web/worker mode is not managed by this CLI launcher.
Use CLI instead:
  .\run.ps1 cli test <url> --brief "..."
Or see README for host-based Web/worker setup.
'@
  }
  'worker' {
    Fail @'
Web/worker mode is not managed by this CLI launcher.
Use CLI instead:
  .\run.ps1 cli test <url> --brief "..."
'@
  }
  'start' {
    Fail @'
Web/worker mode is not managed by this CLI launcher.
Use CLI instead:
  .\run.ps1 cli test <url> --brief "..."
'@
  }
  default { Fail "Unknown command: $Command. Run .\run.ps1 help" }
}
