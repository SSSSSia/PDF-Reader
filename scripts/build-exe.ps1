# 一键构建自包含 exe：
#   1) 先用 PyInstaller 把 Python 后端打包为 Tauri sidecar（src-tauri/sidecar/）
#   2) 再 tauri build 把 sidecar 一并打进桌面应用
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1
# 跳过后端打包（仅当 sidecar 已存在且未改动后端时）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -SkipBackend

param(
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"

if (-not $SkipBackend) {
    Write-Host "==> [1/2] 构建内嵌后端 sidecar ..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
}

Write-Host "==> [2/2] 构建桌面应用 (tauri build) ..." -ForegroundColor Cyan
npm run tauri build

Write-Host "完成。产物位于 src-tauri/target/release/bundle/。" -ForegroundColor Green
