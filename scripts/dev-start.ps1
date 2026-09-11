# 开发环境一键启动（2026-09-08 修订）：
# 后端原以 -WindowStyle Hidden 启动，stdout/stderr 全部丢弃——
# 用户反馈"点『式』报错但后端没有日志"即由此而来（异常无从查看）。
# 现将后端输出重定向到 logs/backend-dev.log，排查时直接看文件。
$logDir = Join-Path $PSScriptRoot "..\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "backend-dev.log"
$err = Join-Path $logDir "backend-dev.err.log"

# 后端必须用项目根 .venv 的解释器（系统 python 未装 backend 依赖，新机器实测）
$venvPython = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
Start-Process -FilePath $venvPython -ArgumentList "backend/main.py" `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err
Start-Process -FilePath "npm" -ArgumentList "run", "tauri", "dev" -WindowStyle Normal

Write-Host "后端日志: $out（错误: $err）"
