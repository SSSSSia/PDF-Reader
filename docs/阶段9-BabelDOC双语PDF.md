# 阶段 9：BabelDOC 双语 PDF——真·排版对齐的整篇导出（v0.11.0）

> **状态**：📋 计划已确认，待启动（2026-09-10 用户确认立项） ｜ **前置**：阶段 7 进行中（无阻塞依赖，可并行推进；阶段 7 剩余 T5 不阻塞本阶段） ｜ **依据**：用户需求 2026-09-10（达到「沉浸式翻译」排版效果；产品卖点=免费，翻译模型沿用 SiliconFlow 免费 Qwen3-8B）
> **目标一句话**：后端集成开源 BabelDOC 引擎（子进程调用），一键把当前 PDF 整篇翻译生成**排版一致的双语对照 PDF**（图表/公式原位保留），在应用内直接打开查看——补齐实时左右对照无法达到的「真 PDF 排版对齐」场景。

---

## 1. 背景与证据

- 用户三轮验收反馈（2026-09-09/10）：HTML 叠加式左右对照的对齐已收敛到物理极限（字号跟随原块后右栏/左栏页高比 3.3→1.8），但「沉浸式翻译」那种**图表原位保留、逐段精确对位**的效果在 HTML 架构下不可达。
- 用户给出的目标参照：BabelDOC 输出（HippoRAG 图表页原文/译文对照，排版像素级一致）。
- 调研结论（2026-09-10，GitHub README 实证）：BabelDOC（funstory-ai，AGPL-3.0）——Python 3.12 / pip 可装 / CLI 支持 `--openai-base-url` 接任意 OpenAI 兼容 API（= 现有 SiliconFlow 配置直接复用）/ 输出双语对照 PDF（同页并排或交替页）/ Windows 可用 / 默认水印可关（`--watermark-output-mode`）。
- **产品约束**：卖点=免费。BabelDOC 引擎开源免费、只管排版不管翻译；翻译仍走用户自配的免费 Qwen3-8B——成本结构不变，用户花费 0。
- 与现有左右对照的关系：**并存互补**——左右对照管「实时、块级联动、交互式精读」；BabelDOC 管「整篇导出、排版完美、可分享存档」。不做替代。

## 2. 范围

**做**：后端 venv 引入 BabelDOC（CLI 子进程隔离调用）+ SiliconFlow/Qwen3-8B 跑通验证；导出任务端点（启动/进度/取消/缓存幂等）；前端「生成双语 PDF」入口 + 进度展示；产物（dual 双语 PDF）纳入文档管理并可用现有阅读器打开；AGPL 合规声明。
**不做**：BabelDOC 源码级集成/魔改（只用 CLI，锁版本）；术语表管理 UI（后续增强）；扫描版 OCR 支持（BabelDOC 有限支持，效果不承诺）；表格翻译（其实验性功能默认关闭）；移动端。

## 3. 任务分解

- [ ] **T0 前置验证（半天，gatekeeper）**：后端 venv `pip install BabelDOC`（锁版本 pin）；CLI 端到端跑通一篇真实论文（RAPTOR 或 TOG）：
  `babeldoc --files x.pdf --openai --openai-base-url <siliconflow> --openai-model Qwen/Qwen3-8B --openai-api-key <key> --custom-system-prompt "/no_think ..." --no-auto-extract-glossary --qps 2 --watermark-output-mode no_watermark --output <dir>`
  验收：双栏+图表+公式页排版正确、Qwen3 无思考链污染、记录耗时/token 量级。**不通过则回到用户重新规划**（这正是"实在不行另作规划"的检查点）
- [ ] **T1 后端导出服务（`backend/export/babeldoc_export.py` 新模块）**
  - `POST /api/export/babeldoc`：启动任务——参数 (file_path)；子进程跑 CLI（`--output` 到 cache 目录，命名含 pdf_hash+model），读取 configStore 同款 API 配置（base_url/key/model）；**key 只经环境变量传子进程，不进日志/不落盘**
  - 进度：CLI `--report-interval` 输出解析 → 内存任务表 `{job_id, status, progress}`；`GET /api/export/babeldoc/{job_id}` 查询；`DELETE` 取消（kill 子进程）
  - 幂等缓存：(pdf_hash, model, babeldoc版本) 命中直接返回已有产物，不重复翻译
- [ ] **T2 前端入口与进度（`ReaderToolbar` / `bridge.ts` / 新组件）**
  - 入口：导出菜单旁新增「双语 PDF」（原版组与重排版通用，对任意已打开文档可用）
  - 状态：启动后轮询进度（进度条+阶段文案：解析布局/翻译中/生成 PDF），完成/失败通知
  - 重复点击防抖：进行中禁用；失败可重试（保留 stderr 摘要展示）
- [ ] **T3 产物管理（文档库打通）**
  - 生成的双语 PDF 注册进文档列表（标题加「双语」标记）或完成后直接用现有阅读器打开（原版点击翻译形态渲染即可）
  - 重开应用不丢（产物持久于 cache 目录）
- [ ] **T4 失败处理与边界**
  - 首跑布局模型权重下载失败：报错文案引导（含手动下载/离线资产 `--generate-offline-assets` 路径）
  - 免费档限流 429：qps 降级重试（指数退避，最多 3 次）
  - 大文档：`--max-pages-per-part` 分批 + 各批进度聚合
- [ ] **T5 合规与文档**
  - README 增「第三方组件」节：BabelDOC（AGPL-3.0）经 CLI 子进程调用、版本 pin、署名保留说明
  - 关于/设置页一行声明
  - 顺带复验阶段 7 遗留 T5（双栏缩放适配）与本阶段产物阅读无冲突

## 4. 验收标准（全部满足才算完成）

1. 一篇真实论文（含双栏、图表、公式，如 HippoRAG/TOG）端到端生成双语 PDF：图表与公式原位保留、段落对位无明显错乱、Qwen3 输出无思考链污染。
2. 全程进度可视（解析/翻译/生成三阶段），完成后一键打开产物；失败有可读错误与重试。
3. 同一文档重复触发不重复翻译（缓存命中，秒级返回）。
4. API key 不出现在任何日志、任务表、产物元数据中。
5. `pytest` 全过、`npx tsc --noEmit` 与 `npx vite build` 通过；README 含 AGPL 第三方组件声明。

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 首次运行需下载 DocLayout-YOLO 权重（网络失败/慢） | T0 提前暴露；失败时提供离线资产包路径与手动放置指引 |
| 免费档限流 → 整篇翻译耗时数分钟至更久 | `--qps` 调低+退避重试；进度透明化；产物缓存幂等，只等一次 |
| Qwen3-8B 小模型整篇翻译质量波动 | `/no_think` 固化；术语表/换模型作为后续增强（架构不绑定单一模型） |
| AGPL-3.0 传染顾虑 | 仅 CLI 子进程调用+锁版本+README 显式声明；不链接其源码、不分发其产物代码 |
| BabelDOC 无稳定 Python API 承诺（README 警告 internal） | 只走 CLI 边界（参数均为公开文档化选项）；升级需过回归 |
| 已知缺陷波及体验（作者/参考文献段合并、跨页段落不支持） | 验收时明确标注为引擎限制，文档写明；不阻塞主流程 |

> 任务编号引用格式：`阶段9-Tx`（提交信息与日志用）。阶段 7 剩余项（T5 双栏缩放复验）挂在本阶段 T5 顺带复验，不单独立项。
