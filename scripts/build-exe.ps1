# 一键构建自包含 exe：
#   1) 阶段9-T6：暂存 BabelDOC 运行时（embeddable python + site-packages）到
#      dist/babeldoc-runtime/，作为 tauri resources 随安装包捆绑（开箱即用）
#   2) 先用 PyInstaller 把 Python 后端打包为 Tauri sidecar（src-tauri/sidecar/）
#   3) 再 tauri build 把 sidecar + 运行时一并打进桌面应用
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1
# 跳过后端打包（仅当 sidecar 已存在且未改动后端时）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -SkipBackend
# 跳过运行时暂存（仅调试用——正式发布必须包含运行时，否则对照功能不可用）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -SkipRuntime

param(
    [switch]$SkipBackend,
    [switch]$SkipRuntime
)

$ErrorActionPreference = "Stop"

$steps = 3
if (-not $SkipRuntime) {
    Write-Host "==> [1/$steps] 暂存 BabelDOC 运行时（tauri resources 捆绑用）..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File scripts/build-babeldoc-runtime.ps1 -SkipZip
}
else {
    Write-Host "==> [1/$steps] 跳过运行时暂存（-SkipRuntime）" -ForegroundColor Yellow
}

if (-not $SkipBackend) {
    Write-Host "==> [2/$steps] 构建内嵌后端 sidecar ..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
}

Write-Host "==> [3/$steps] 构建桌面应用 (tauri build) ..." -ForegroundColor Cyan
npm run tauri build

Write-Host "完成。产物位于 src-tauri/target/release/bundle/。" -ForegroundColor Green
