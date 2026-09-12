# 构建 BabelDOC 运行时（阶段9-T6 直接捆绑方案）。
#
# 产出：dist/babeldoc-runtime/ 暂存目录（tauri resources 捆绑用，开箱即用）；
#       默认另压 dist/babeldoc-runtime-win64.zip（便携分发/留档，可 -SkipZip 跳过）
# 结构：babeldoc-runtime/{python.exe, Lib/site-packages/, python*._pth, runtime-version.txt}
#   - python-3.12 embeddable（自包含，无需用户安装 Python）
#   - .venv-babeldoc 的 site-packages 全量（babeldoc 0.6.4 锁版本）
# 后端检测链：开发态项目 venv → 后端 exe 同级 babeldoc-runtime/（随包安装位）
#
# 用法：powershell -File scripts/build-babeldoc-runtime.ps1 [-Proxy "http://127.0.0.1:10090"] [-SkipZip]
param(
  # embeddable python 下载地址（默认 3.12.10，与 .venv-babeldoc 的 3.12 同 minor 版本）
  [string]$PythonEmbedUrl = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
  # HTTP 代理（可选；流量敏感/受限网络时传入，如 http://127.0.0.1:10090）
  [string]$Proxy = "",
  # 跳过压缩（捆绑进安装包只需要暂存目录，zip 仅便携分发/留档时需要）
  [switch]$SkipZip
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv-babeldoc"
if (-not (Test-Path (Join-Path $venv "Lib\site-packages"))) {
  throw "未找到 $venv —— 请先按 docs/阶段9-BabelDOC双语PDF.md 创建 BabelDOC venv"
}
# 暂存目录必须在 vite frontendDist（dist/）之外——vite build 的 emptyOutDir
# 会清空 dist/，暂存放那里会在 tauri build 过程中被抹掉（2026-09-12 实测）
$dist = Join-Path $root "build"
$stage = Join-Path $dist "babeldoc-runtime"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }

# 1) embeddable python
$embZip = Join-Path $dist "python-embed-3.12.zip"
if (-not (Test-Path $embZip)) {
  Write-Host "下载 embeddable python：$PythonEmbedUrl"
  $iwr = @{ Uri = $PythonEmbedUrl; OutFile = $embZip; UseBasicParsing = $true }
  if ($Proxy) { $iwr.Proxy = $Proxy }
  Invoke-WebRequest @iwr
}
Expand-Archive -Path $embZip -DestinationPath $stage -Force

# 2) site-packages 全量拷贝（约 660MB，数分钟）
Write-Host "拷贝 site-packages…"
Copy-Item -Path (Join-Path $venv "Lib\site-packages") `
  -Destination (Join-Path $stage "Lib\site-packages") -Recurse -Force

# 3) python*._pth：加入 site-packages 并启用 site 初始化（embeddable 默认关闭）
$pth = Get-ChildItem $stage -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) { throw "embeddable 包内未找到 python*._pth" }
@("python312.zip", ".", "Lib/site-packages", "import site") |
  Set-Content -Path $pth.FullName -Encoding ASCII

# 4) 版本描述（随包留档）
$venvPy = Join-Path $venv "Scripts\python.exe"
$bdv = & $venvPy -c "import importlib.metadata as m; print(m.version('babeldoc'))"
$pyv = & $venvPy -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"
"babeldoc-$bdv py$pyv $(Get-Date -Format 'yyyy-MM-dd')" |
  Set-Content (Join-Path $stage "runtime-version.txt") -Encoding ASCII
Write-Host "运行时版本：babeldoc-$bdv py$pyv"

# 5) 冒烟自检：运行时 python 能 import babeldoc（_pth 配置有效的证据）
& (Join-Path $stage "python.exe") -c "import babeldoc; print('smoke ok', babeldoc.__version__ if hasattr(babeldoc,'__version__') else '')"
if ($LASTEXITCODE -ne 0) { throw "运行时冒烟自检失败：babeldoc import 不可用" }

if (-not $SkipZip) {
  # 6) 压缩留档（bsdtar 生成 zip；装有 7z 可手动改用，压缩率更高）
  $out = Join-Path $dist "babeldoc-runtime-win64.zip"
  if (Test-Path $out) { Remove-Item $out -Force }
  Write-Host "压缩中（约 1-3 分钟）…"
  & (Join-Path $env:SystemRoot "System32\tar.exe") -a -c -f $out -C $dist "babeldoc-runtime"
  if ($LASTEXITCODE -ne 0) { throw "压缩失败" }

  # 7) 摘要
  $sha = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  $mb = [math]::Round((Get-Item $out).Length / 1MB)
  Write-Host "`n构建完成：$out"
  Write-Host "大小：$mb MB  sha256：$sha"
}
Write-Host "`n暂存目录就绪：$stage（tauri resources 捆绑用，可直接 tauri build）"
