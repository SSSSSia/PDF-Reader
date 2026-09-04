# PDF 双语对照阅读器

将 PDF 文件转为双语对照阅读界面，支持左右对照和译文紧跟两种排版模式。

## 功能

- 📄 PDF 文件上传与识别
- 🔍 OCR 识别（PaddleOCR-VL-1.5）
- 🌐 多语言翻译（支持 OpenAI/Google/DeepL/SiliconFlow）
- 👁️ 左右对照 + 紧跟模式双语阅读
- 📜 滚动同步
- 💾 翻译结果缓存
- ⚙️ API Key 配置

## 快速开始

### 系统要求
- Windows 10+
- Node.js 18+
- Python 3.10+
- Rust 1.70+

### 安装依赖

```bash
# 前端依赖
npm install

# Python 后端依赖
pip install -r requirements.txt
```

### 配置 API Key

1. 注册 [SiliconFlow](https://siliconflow.cn) 获取 API Key（PaddleOCR-VL-1.5 免费）
2. 打开软件 → 设置 → 填入 API Key
3. OCR 和翻译默认都使用 SiliconFlow

### 开发模式

```bash
# 启动后端
python backend/main.py

# 启动前端
npm run tauri dev
```

### 打包 exe

```bash
npm run tauri build
```

打包产物位于 `src-tauri/target/release/bundle/exe/`。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri v2 (Rust) |
| 前端 | React + TypeScript + Tailwind CSS |
| 后端 | FastAPI (Python) |
| OCR | PaddleOCR-VL-1.5 via SiliconFlow API（免费） |
| 翻译 | SiliconFlow / OpenAI / Google / DeepL |

## 项目结构

```
src-tauri/     # Tauri Rust 桌面壳
src/           # React 前端
backend/       # FastAPI Python 后端
```

## 许可证

MIT License
