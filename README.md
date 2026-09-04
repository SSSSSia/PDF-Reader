# PDF 双语对照阅读器

本地优先的 **PDF 双语对照阅读 / 翻译桌面软件**：上传 PDF → OCR 识别 → LLM 翻译 → **左右双语对照** 或 **译文紧跟原文**。

- 左右对照：原文 / 译文双栏同步滚动
- 紧跟模式：原文段下嵌入译文
- 翻译结果本地缓存，避免重复调用
- 页面缩略图导航、暗色模式、拖拽上传、导出双语 Markdown / 纯文本
- 全部走云端 API（OCR 与翻译均使用 [SiliconFlow](https://siliconflow.cn) 免费额度），exe 不含任何模型权重

> 设计目标：**个人本地使用 + 开源可复刻**。配置一次 API Key 即可开箱阅读；他人 clone 后按本文档即可跑起来。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri v2（Rust） |
| 前端 | React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3 + Zustand 4 |
| 后端 | FastAPI（Python 3.11+），以 Tauri **sidecar** 形式内嵌随 exe 分发 |
| OCR | SiliconFlow `PaddlePaddle/PaddleOCR-VL-1.5`（图片接口） |
| 翻译 | SiliconFlow（OpenAI 兼容 `chat/completions`），可扩展 provider 抽象 |

架构数据流：

```
React 前端 (src/)
   │  invoke (Tauri 命令)
   ▼
Rust 后端 (src-tauri) ── reqwest ──► FastAPI 后端 (127.0.0.1:8000)
                                        │  HTTPS + Bearer Key
                                        ▼
                              SiliconFlow API（OCR / 翻译）
```

---

## 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 20 | 前端 / Tauri CLI |
| Python | ≥ 3.11 | 内嵌后端（也用于开发态直接起 FastAPI） |
| Rust 工具链 | 稳定版 | 编译桌面壳 |
| **Windows 10/11 SDK** | — | **Rust 的 MSVC 链接必需**（见下方「排错」） |
| SiliconFlow API Key | — | OCR 与翻译（免费额度即可） |

> 分发包仅面向 **Windows**。文档写清了依赖与步骤，便于他人参考复刻，但不保证开箱跨平台。

---

## 快速开始（开发态）

```powershell
# 1) 安装前端依赖
npm install

# 2) 准备后端依赖（建议用虚拟环境）
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# 3) 配置 API Key
#    复制模板并填入你的 SiliconFlow Key：
cp config/config.example.json config/config.json
#    然后编辑 config/config.json，把 ocr.api_key / translate.api_key 填上

# 4) 一键启动（前端 + 后端 + Tauri 窗口）
powershell -ExecutionPolicy Bypass -File scripts/dev-start.ps1
```

开发态下 Rust 端**不会**拉起内嵌 sidecar，而是沿用脚本启动的外部 FastAPI（避免争用 8000 端口）。

---

## 配置 API Key

应用配置位于（按优先级）：

1. 环境变量 `PDF_READER_CONFIG` 指向的文件（可选，测试 / 自定义部署用）
2. Windows：`%APPDATA%/pdf-reader/config.json`
3. 其他：`~/.pdf-reader/config.json`

配置字段（全部 `snake_case`）：

```json
{
  "ocr": {
    "provider": "siliconflow",
    "api_key": "<你的 SiliconFlow Key>",
    "api_url": "https://api.siliconflow.cn/v1",
    "model": "PaddlePaddle/PaddleOCR-VL-1.5"
  },
  "translate": {
    "provider": "siliconflow",
    "api_key": "<你的 SiliconFlow Key>",
    "api_url": "https://api.siliconflow.cn/v1",
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "target_language": "en",
    "source_language": "zh"
  },
  "ui": { "default_mode": "bilingual", "theme": "light" }
}
```

> OCR 与翻译使用同一家的免费模型，填同一个 Key 即可。改完配置**无需重启**后端（配置按文件修改时间热重载）。

---

## 打包发布（自包含 exe）

打包前**必须先**把 Python 后端编译为 Tauri sidecar，再 `tauri build` 一并打入：

```powershell
# 在仓库根目录执行，一键完成两步：
powershell -ExecutionPolicy Bypass -File scripts/build-exe.ps1
```

产物位于 `src-tauri/target/release/bundle/`。

单独构建后端 sidecar（产出 `src-tauri/sidecar/pdf-backend-<triple>.exe`）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
```

### 排错：Rust 链接失败

- **报 `link.exe` / `MSVCRTD` 相关错误**：本机缺 **Windows 10/11 SDK**。请通过 Visual Studio Installer 安装「使用 C++ 的桌面开发」工作负载（含 Windows 10/11 SDK）。
- **`link.exe` 被 Git Bash 的 `/usr/bin/link` 遮蔽**：在 **「x64 Native Tools for VS」/「Developer PowerShell」** 环境中构建，不要直接在普通 Git Bash 里 `cargo build`。
- 本机仅安装 Windows Kits 8.1 时，`cargo check` / `tauri build` 会在链接阶段失败（**非代码问题**），换到带 10/11 SDK 的环境即可。

---

## 测试与 CI

```powershell
# 后端测试（无网络依赖，使用 mock）
cd backend
pip install -r requirements-dev.txt
pytest

# 前端类型检查与构建
npx tsc -b
npx vite build
```

仓库已配置 GitHub Actions：push / PR 到 `dev`、`master` 时自动运行前端 `tsc + vite build` 与后端 `pytest`。
（Rust / Tauri 构建因需 Windows SDK，目前仅在本地验证，详见 CI 注释。）

---

## 项目结构

```
PDF-Reader/
├── src/                     # React 前端
│   ├── components/          # 页面与阅读组件（Main/Bilingual/Inline/PdfViewer/ExportBar…）
│   ├── stores/              # Zustand 状态（config/pdf/ui）
│   ├── hooks/              # useOcr（轮询流水线）/ useScrollSync / usePdfThumbnails
│   ├── utils/export.ts     # 双语 Markdown / 纯文本导出
│   └── types/index.ts       # 前后端一致的数据结构
├── backend/                 # FastAPI 后端（内嵌 sidecar）
│   ├── ocr/                # SiliconFlow OCR（PDF→PyMuPDF 转图→/chat/completions）
│   ├── translate/           # provider 抽象 + 注册表（siliconflow/openai 可用，google/deepl 待实现）
│   ├── pipeline/            # OCR→切块→翻译 流水线，并发 + 渐进回显
│   ├── cache/              # 两层缓存（OCR 层 / 译文层）
│   └── tests/              # pytest 单测
├── src-tauri/               # Rust 桌面壳（sidecar 管理、Tauri 命令、导出写盘）
├── scripts/                 # dev-start / build-backend / build-exe
├── config/                  # config.example.json（模板，真实 config.json 已被 .gitignore 排除）
├── docs/                    # 开发总纲（单一事实来源）、版本规划
└── .github/workflows/ci.yml
```

---

## 路线图

| 版本 | 阶段 | 内容 |
|------|------|------|
| `v0.1.0`（已发布） | Phase 0 + 部分 Phase 1 | 主链路打通、OCR 重写、缓存、配置热更新、缩略图 |
| `v0.2.0`（已规划） | Phase 2 | provider 抽象、暗色模式、拖拽上传、导出双语 |
| `v0.3.0`（进行中） | Phase 3 | 测试 + CI、LICENSE、配置模板、README 复刻指南、构建串联 |

详细开发约束与接口契约见 [`docs/开发总纲.md`](docs/开发总纲.md)；版本 / 发版节奏见 [`docs/版本规划.md`](docs/版本规划.md)。

---

## License

[MIT](LICENSE)
