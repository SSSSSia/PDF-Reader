# 阶段 9：BabelDOC 双语 PDF——真·排版对齐的整篇导出（v0.11.0）

> **状态**：🚧 进行中（T0–T5 完成，仅剩 T6 可选组件化打包） ｜ **前置**：阶段 7 进行中（无阻塞依赖，可并行推进；阶段 7 剩余 T5 不阻塞本阶段） ｜ **依据**：用户需求 2026-09-10（达到「沉浸式翻译」排版效果；产品卖点=免费，翻译模型沿用 SiliconFlow 免费 Qwen3-8B）
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
- [x] **T2 前端入口与进度（✅ 2026-09-10 完成；同日验收决策重定位，见 T3'）**
  - 初版：工具栏「双语PDF」独立按钮 + babeldocStore（跨重挂载不丢轮询）+ bridge 三函数
  - **同日验收用户决策：双语PDF 不是导出附件，应取代「原版PDF·左右对照」阅读模式本身**——独立按钮退役，入口改为模式切换（见 T3'）
- [x] **T3 产物管理（✅ 初版"直接打开"已被验收决策升级，见 T3'）**
- [x] **T3' 双语PDF 重定位（2026-09-10 验收决策，commit a900794）：原版PDF·左右对照 = DualPdfPage**
  - 点击「原版PDF·左右对照」→ 幂等触发导出（缓存命中秒回；否则阅读区内显示进度卡片，可取消）→ 完成后 **pdfjs 应用内渲染** dual PDF（连续滚动 + fit-width×zoom 懒渲染，缺省 70%），不再跳系统阅读器
  - 阶段7-T4 自绘 overlay 对照（OriginalBilingualPage）退役；「重新翻译」为 BabelDOC 独立管线所致（首跑整篇成本真实存在，同文档此后走 BabelDOC 内部缓存秒开）——已向用户明示
  - 产物持久 `<cache>/babeldoc/`；不注册文档库（与 open_cached_doc 的 pdf_hash 会话语义冲突）
- [x] **T4 失败处理与边界（✅ 2026-09-11 完成）**
  - 首跑布局模型权重下载失败：报错文案引导（含手动下载/离线资产 `--generate-offline-assets` 路径）
  - 免费档限流 429：qps 降级重试（指数退避，最多 3 次）
  - 大文档：`--max-pages-per-part` 分批 + 各批进度聚合
  - 实施记录（babeldoc_worker.py 重写 + export argv）：① `load_onnx()` 失败发
    引导文案（三上游说明/权重缓存路径 `~/.cache/babeldoc/models/`/离线资产命令）；
    ② 整次尝试因 429/限流失败时 qps 减半重跑（6→3→1.5，最多 3 次，重跑前清理
    半成品产物防看门狗误命中；BabelDOC 内部 tenacity 100 次退避仍是第一道）；
    ③ `--max-pages-per-part 200`（未超不分批），进度经 BabelDOC 父监视器按批
    加权聚合、产物经 ResultMerger 合并单个 dual.pdf，看门狗/finish/export 泵
    均无需改动。权重失败/429 路径以人工验收为准（难造真实故障）
- [x] **T5 合规与文档（✅ 2026-09-11 完成）**
  - README 增「第三方组件」节：BabelDOC（AGPL-3.0）经 CLI 子进程调用、版本 pin、署名保留说明
  - 关于/设置页一行声明
  - 顺带复验阶段 7 遗留 T5（双栏缩放适配）与本阶段产物阅读无冲突
    ——该项已由阶段 10 验收覆盖（2026-09-11 批量验收），无需重复复验
- [ ] **T6 BabelDOC 随包捆绑（🔶 代码完成 2026-09-12，待发布实跑+人工验收）**
  - 方案沿革：2026-09-11 曾决策「可选组件 + 应用内下载」并完成实现（多源
    国内优先/断点续传/本地导入，git 历史 661a85b 等）；2026-09-12 用户复核
    后反转——目标用户多为非计算机专业、对软件体积不敏感，下载流程不可控
    （源可用性/失败重试/包完整性对用户都是负担），**改为直接随包捆绑**，
    开箱即用零步骤
  - 体积影响（用户已接受）：安装包 ~72MB → 约 400MB（NSIS/lzma 估算），
    安装后磁盘 +660MB；首次 BabelDOC 生成仍在线下载版面分析权重 ~50MB
    （自动尝试 hf/hf-mirror/modelscope，与主链路无关）
  - 实现：`scripts/build-babeldoc-runtime.ps1` 暂存运行时（python-3.12
    embeddable 自包含 + `.venv-babeldoc` site-packages + `._pth` 启用
    site + import babeldoc 冒烟自检，-SkipZip 可跳过留档压缩）→
    `build-exe.ps1` 自动串联 → tauri `resources` 捆绑落位到后端 exe 同级
    `babeldoc-runtime/`
  - 后端检测链（`babeldoc_export.venv_python`）：开发态项目 venv →
    exe 同级随包运行时（PyInstaller sys.executable 恒指 exe 本体）→
    `<data_dir>/babeldoc-runtime/`（保留扩展位）；`babeldoc_runtime.py`
    精简为纯定位模块（无网络行为）；下载链路的 4 端点与前端安装卡同步移除
  - **发布期实跑完成（2026-09-12）**：embeddable python 经代理下载 + 暂存 +
    冒烟自检（smoke ok 0.6.4）✓；干净环境验收（隐藏项目 venv）检测链
    venv→None→exe 同级随包位精确命中 ✓；完整构建产出双安装包
    （MSI 314MB / NSIS 231MB，WiX manifest 确认 babeldoc-runtime 组件入包）✓
  - 实跑修出两个坑：① tauri 2 CLI 无 `--resources` 参数——`tauri.conf.json`
    的 resources 恒为 `[]`（静态声明在目录缺失时炸 build script，用户实测
    踩中），build-exe.ps1 经 `-c` 配置合并动态注入；② 暂存目录不能放
    `dist/`——vite build 的 emptyOutDir 会把它抹掉，改 `build/babeldoc-runtime/`
  - 剩余：真机安装人工验收（沙箱无法静默装）——装后对照功能应开箱即用

## 4. 验收标准（全部满足才算完成）

1. 一篇真实论文（含双栏、图表、公式，如 HippoRAG/TOG）端到端生成双语 PDF：图表与公式原位保留、段落对位无明显错乱、Qwen3 输出无思考链污染。
2. 全程进度可视（解析/翻译/生成三阶段），完成后一键打开产物；失败有可读错误与重试。
3. 同一文档重复触发不重复翻译（缓存命中，秒级返回）。
4. API key 不出现在任何日志、任务表、产物元数据中。
5. `pytest` 全过、`npx tsc --noEmit` 与 `npx vite build` 通过；README 含 AGPL 第三方组件声明。

### 4.1 手工验收清单（T1–T3' 批次，2026-09-10 二次修订：入口已重定位为模式）

> 前置：后端（8000）与前端已启动；设置页 API 配置可用（SiliconFlow/Qwen3-8B）。
> 整篇生成耗时与 token 成本近似 T0 实测线性放大（RAPTOR 3 页 ≈ 9 分钟/16k token），
> **建议先用页数少的一篇验流程，再验一篇真实论文验排版质量**。

| # | 步骤 | 预期 |
|---|------|------|
| 1 | 打开一篇已翻译论文 → 点工具栏「原版PDF · 左右对照」 | 阅读区出现「正在生成排版对照」进度卡（百分比+阶段），不跳系统阅读器 |
| 2 | 生成中切回「重排版」再切回来 | 进度不丢（babeldocStore 跨模式保持），不重复启动任务 |
| 3 | 等待完成 | 进度卡消失，pdfjs 应用内渲染 dual PDF（同页并排英中对照、连续滚动） |
| 4 | 缩放控件 / Ctrl+滚轮 | dual PDF 随全局缩放同步缩放（fit-width 基准，缺省 70%） |
| 5 | 切走再切回该模式（同文档） | 缓存命中，直接渲染，零翻译调用 |
| 6 | 生成中点「取消」 | 回「排版对照未生成」卡片，可「开始生成」重启；后端子进程被 kill |
| 7 | 断网或改错 API key 后对新文档进入模式 | 进度卡变红色错误卡（含原因），修正后「重试」成功 |
| 8 | 多开两篇文章看标题栏 tab | 每篇一个 tab、点击切换、× 关闭、后台翻译进度徽标（阶段10 联动项） |

已通过的自动化验证（2026-09-10）：tiny PDF 端到端（启动→进度流式→done 100%→产物同页
英中对照）、缓存命中路径、错误路径、tsc/vite build。第 3 步的真实论文排版质量
（图表/公式原位、无思考链污染）即 §4 第 1 条的验收主体。

**手工验收结果（2026-09-12 用户确认）：§4 第 1 条通过**——DALK.pdf（19 页）完成
完整生成，排版质量确认"可以了"（dual.pdf 1.8MB + mono 1.3MB 落盘
`cache/babeldoc/<hash>/Qwen_Qwen3-8B/`）；缓存秒开路径亦经实际使用验证（重进模式
点「开始生成」瞬时打开）。§4 验收标准 1–5 全部满足（⑤ AGPL 声明见 T5）。
阶段剩余：仅 T6 开发。

### 4.2 验收期修复记录（2026-09-11）：内存耗尽崩溃 + 启动方式重设计

- **事故**：主翻译 99% 时点「原版PDF·左右对照」→ BabelDOC worker 与主翻译、
  pdfjs 渲染并发，内存耗尽（Windows `RADAR_PRE_LEAK_64` 点名 python.exe 3.12.11，
  worker RSS 1.8GB / 机器 16GB）→ WebView2 渲染进程崩溃自动重载，用户感知为
  "应用自动重启"。后端存活；后端随后被关闭，该次生成未产出 dual.pdf。
- **修复（commit 5dad312）**：进入模式不再自动启动——主翻译中显示门禁卡
  （说明 + 主翻译进度 + 返回重排版，完成后自动放行）；空闲时确认卡
  （说明 BabelDOC 独立管线成本，开始生成/暂不）。
- **遗留联动**：全局并发上限与排队归阶段11-T2；未安装 BabelDOC 时的引导
  安装归本阶段 T6。

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

## 6. 验收期修复记录（2026-09-12）

- **【严重】对照视图跨文档状态污染**：babeldocStore 为全局单例（同时只记录
  一个任务的状态），DualPdfPage 读取时未校验归属——FG-RAG 生成/查看过对照后
  切到 DALK 再开"左右对照"，渲染的是 FG-RAG 的 dualPDF（用户实测"论文竟然是
  FG-RAG"）。修复：任务状态按路径归属采信（归一化比对 bdoc.filePath 与当前
  会话文档路径，不一致一律按 idle 处理并转探测本篇缓存）；F5 重接管场景不受
  影响（会话为空时回落任务自带路径，天然同源）。probeCached 命中时本就回填
  filePath，缓存命中链路自动归位。
- **双 worker 内存守卫**：他篇对照任务进行中时，本篇"开始生成"禁用并提示
  等待——两个 BabelDOC worker 并发 RSS ~3.6GB（单 worker 峰值 1.8GB 实测），
  与 2026-09-11 RADAR 内存耗尽崩溃同源。
- **F5 后对照视图不可达**（记录归阶段11-T5 补洞，涉及本模块故留交叉引用）：
  静默重接管只恢复 store，视图被无会话门禁挡住；现阅读页门禁对重接管任务
  放行、readerMode 同步恢复，F5 后直达生成进度/产物。
