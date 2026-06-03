param(
  [ValidateSet("Release","Debug")][string]$Configuration = "Release",
  [string]$InnoSetupIsccPath = "",
  [string]$OutputDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" }

function Find-IsccExe() {
  if ($InnoSetupIsccPath -and (Test-Path $InnoSetupIsccPath)) { return $InnoSetupIsccPath }

  $cmd = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return ""
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sln = Join-Path $repoRoot "windows\launcher\AttendanceLauncher.sln"
$iss = Join-Path $repoRoot "windows\installer\inno\attendance.iss"

Write-Step "Build tray launcher ($Configuration)"
& dotnet build -c $Configuration $sln

Write-Step "Compile installer (Inno Setup)"
$iscc = Find-IsccExe
if (-not $iscc) {
  throw "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup or pass -InnoSetupIsccPath <full-path-to-ISCC.exe>."
}

if ($OutputDir) {
  $out = (Resolve-Path $OutputDir).Path
  & $iscc "/O$out" $iss
} else {
  & $iscc $iss
}

Write-Step "Done"
Write-Host "If Inno Setup used its default output folder, check the directory next to:"
Write-Host "  $iss"

