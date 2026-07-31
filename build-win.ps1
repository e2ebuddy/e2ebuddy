#!/usr/bin/env pwsh
<#
Packages e2ebuddy release artifacts on Windows (aligned with AICore ADE build-win.ps1).

Usage:
  .\build-win.ps1                 # Host architecture
  .\build-win.ps1 win
  .\build-win.ps1 x64
  .\build-win.ps1 arm64
  .\build-win.ps1 all
  .\build-win.ps1 x64 --skip-build
  .\build-win.ps1 x64 --skip-smoke

Version:
  .\build-win.ps1 x64 --keep
  .\build-win.ps1 x64 --bump
  .\build-win.ps1 x64 --set 0.2.0

Artifacts: release\
  e2ebuddy-<version>.tgz
  e2ebuddy-<version>-win-<arch>.tgz
  e2ebuddy-<version>-win-<arch>-buildinfo.json
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptRoot

function Show-Usage {
  @'
Usage: .\build-win.ps1 [win|x64|arm64|all] [version options] [--skip-build] [--skip-smoke]

  win      Host architecture (default)
  x64      Windows x64
  arm64    Windows ARM64
  all      x64 + arm64 stamps

Version:
  --keep / --bump / --set <ver>

Artifacts: release\e2ebuddy-*.tgz + *-buildinfo.json
'@ | Write-Host
}

function Write-Info {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[e2ebuddy] $Message"
}

function Write-ErrorLine {
  param([Parameter(Mandatory = $true)][string]$Message)
  [Console]::Error.WriteLine("[e2ebuddy] ERROR: $Message")
}

if ($IsWindows -eq $false -and $env:OS -notlike '*Windows*') {
  Write-ErrorLine 'Windows packaging must run on Windows (aligned with ADE build-win.ps1).'
  exit 1
}

$Target = 'win'
$ArgList = @($args)
if ($ArgList.Count -gt 0) {
  $Target = [string]$ArgList[0]
  if ($ArgList.Count -gt 1) {
    $ArgList = @($ArgList[1..($ArgList.Count - 1)])
  } else {
    $ArgList = @()
  }
}

if ($Target -in @('-h', '--help', 'help')) {
  Show-Usage
  exit 0
}

$ExtraArgs = @()
$VersionArgs = @()
for ($i = 0; $i -lt $ArgList.Count; $i++) {
  $arg = [string]$ArgList[$i]
  switch -Exact ($arg) {
    { $_ -in @('--keep', '--bump') } {
      $VersionArgs += $arg
      break
    }
    { $_ -in @('--set', '--version') } {
      $setVer = if ($i + 1 -lt $ArgList.Count) { [string]$ArgList[$i + 1] } else { '' }
      $VersionArgs += @($arg, $setVer)
      $i++
      break
    }
    default {
      $ExtraArgs += $arg
      break
    }
  }
}

function Invoke-Pack {
  param([Parameter(Mandatory = $true)][string[]]$PackArgs)
  $all = @()
  $all += $PackArgs
  $all += $VersionArgs
  $all += $ExtraArgs
  & node scripts/pack.mjs @all
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Write-Info "start pack: win $Target"

switch -Exact ($Target) {
  { $_ -in @('win') } {
    $hostArch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -match 'Arm') { 'arm64' } else { 'x64' }
    Invoke-Pack @('--win', "--$hostArch")
    break
  }
  { $_ -in @('x64', 'intel', 'amd64') } {
    Invoke-Pack @('--win', '--x64')
    break
  }
  { $_ -in @('arm64', 'aarch64') } {
    Invoke-Pack @('--win', '--arm64')
    break
  }
  { $_ -eq 'all' } {
    Invoke-Pack @('--win', '--x64')
    Invoke-Pack @('--win', '--arm64', '--skip-build', '--skip-smoke')
    break
  }
  default {
    Write-ErrorLine "Unknown target: $Target"
    Show-Usage
    exit 1
  }
}

Write-Info 'done. See release/'
if (Test-Path release) {
  Get-ChildItem release | Format-Table Name, Length, LastWriteTime
}
