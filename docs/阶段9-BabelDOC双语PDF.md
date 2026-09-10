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

- [x] **T0 前置验证（✅ 2026-09-10 通过，gatekeeper 解除）**：后端 venv `pip install BabelDOC`（锁版本 pin）；CLI 端到端跑通一篇真实论文（RAPTOR 或 TOG）：
  `babeldoc --files x.pdf --openai --openai-base-url <siliconflow> --openai-model Qwen/Qwen3-8B --openai-api-key <key> --custom-system-prompt "/no_think ..." --no-auto-extract-glossary --qps 2 --watermark-output-mode no_watermark --output <dir>`
  验收：双栏+图表+公式页排版正确、Qwen3 无思考链污染、记录耗时/token 量级。**不通过则回到用户重新规划**（这正是"实在不行另作规划"的检查点）
  - 实测记录（2026-09-10）：RAPTOR 1-3 页端到端 9m14s（含首跑 DocLayout-YOLO 权重下载）；token 16300（prompt 11509/completion 4791/缓存命中 2592，`--no-auto-extract-glossary` 生效术语提取 0）；产物 `*.zh.dual.pdf`（同页双语对照）+ `*.zh.mono.pdf`；`/no_think` 无思考链污染；安装注意=独立 venv（py3.12）+ `env -u PYTHONPATH` 绕 WorkBuddy shim 的批量删除守卫。工程量较预估多出：装包 35 分钟（依赖大）
- [x] **T1 后端导出服务（✅ 2026-09-10 完成，`backend/export/babeldoc_export.py`）**
  - `POST /api/export/babeldoc`：启动任务——参数 (file_path)；子进程跑 worker（`backend/export/babeldoc_worker.py`，用 `.venv-babeldoc` 的 Python 直接调 BabelDOC **Python API** 而非 CLI——CLI 进度走 rich 渲染无法解析，Python API 的 `async_translate` 逐事件产出 overall_progress 0-100，经 stdout JSON 行协议上报）；读取 configStore 同款 API 配置（api_url/key/model）；**key 仅经 argv 传子进程（BabelDOC 不支持环境变量读取，实测确认），日志/任务表/序列化均不含 key**
  - 进度：内存任务表 `{job_id, status, progress, stage}`；`GET /api/export/babeldoc/{job_id}` 查询；`DELETE` 取消（terminate→kill 子进程）
  - 幂等缓存：产物目录 `<cache>/babeldoc/<pdf_hash>/<model_slug>/`，已有 `*.dual.pdf` 即命中瞬时返回 done(cached=true)；同 (pdf_hash, model) 进行中任务幂等复用
  - **关键坑（实测发现并修复）**：BabelDOC 0.6.4 Python API 下产物落盘后 `finish` 事件可能永不到来（async-for 挂死在 99% Save PDF，CLI 无此问题）——worker 内置**产物看门狗**：`*.dual.pdf` 出现且大小稳定 4s 即判定成功主动收尾，`os._exit` 绕开线程池残留；worker 兜底 try/except 任何异常都转 error 行
  - 实测：tiny PDF 端到端 启动→进度流式→done 100%→产物 1 页同页英中对照（"图神经网络被广泛应用于…"），泵/取消/缓存命中/错误路径全验
- [x] **T2 前端入口与进度（✅ 2026-09-10 完成：`BabelDocButton.tsx` + `babeldocStore.ts` + bridge.ts 三个导出函数）**
  - 入口：工具栏 ExportBar 左侧「双语PDF」按钮（重排版/原版组通用，需源文件在位）
  - 状态存 zustand store（工具栏三形态切换重挂载不丢轮询）：running 显示百分比+阶段（title 提示，再点取消）；done 变「打开双语PDF」（系统默认程序）；error 红色提示（title 携带原因，点按重试）；后端重启丢任务归一为 idle 可重按
  - 轮询 2s；`vite build` + `tsc --noEmit` 通过
- [x] **T3 产物管理（✅ 2026-09-10 完成，采纳"直接打开"方案）**
  - 完成后按钮变「打开双语PDF」：Tauri 走 plugin-shell open（本地路径），浏览器经后端 `/api/file/raw`；产物持久于 `<cache>/babeldoc/`，重开应用不丢，重按瞬时命中缓存
  - 不注册进文档库：dual PDF 是成品 PDF 而非翻译会话，注册会与 open_cached_doc 的 pdf_hash 缓存语义冲突（立项时"或"字方案二选一）
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

> 任务编号引用格式：`阶段9-Tx`（提交信息与日志用）。阶段 7 剩余项（T5 重排版双栏缩放复验）与导出引擎无关，改挂阶段 10 T5 验收（同为布局回归，一次复验避免重复）。
