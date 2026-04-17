# @file build_sidecar.ps1
# @description PyInstaller 打包 Windows sidecar
# @author Atlas.oi
# @date 2026-04-17

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$triple = "x86_64-pc-windows-msvc"
$outDir = "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

uv sync
uv run pyinstaller `
  --onefile `
  --name "ghostterm-thesis-$triple" `
  --distpath $outDir `
  --workpath ".\build" `
  --specpath ".\build" `
  --clean `
  --noconfirm `
  main.py

Write-Host "done: $outDir\ghostterm-thesis-$triple.exe"
