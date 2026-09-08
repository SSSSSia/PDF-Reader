export interface AppConfig {
  ocr: OcrConfig;
  translate: TranslateConfig;
  ui: UiConfig;
}

export interface OcrConfig {
  provider: string;
  api_key: string;
  api_url: string;
  model: string;
  optional_payload: Record<string, boolean>;
}

export interface TranslateConfig {
  provider: string;
  api_key: string;
  api_url: string;
  model: string;
  target_language: string;
  source_language: string;
}

export interface UiConfig {
  default_mode: "bilingual" | "inline";
  theme: "light" | "dark";
}

export interface TextBlock {
  block_id: number;
  page: number;
  original: string;
  translated: string;
  position: { y_start: number; y_end: number };
  /** 原版对照模式（阶段5-T1/D6）：PyMuPDF 页面坐标 [x0,y0,x1,y1]（pt，top-left 原点）；
   *  前缀匹配失败（公式碎块/图内文字/扫描页）为 null/缺省 → 不渲染 overlay。
   *  恒等于 bboxes 首段（兼容旧消费方） */
  bbox?: [number, number, number, number] | null;
  /** 多段坐标（断栏续接/跨页合并/作者行多段）：全部命中分段，page 为段所在页；
   *  缺省/空数组时回退用 bbox（挂在块所属页） */
  bboxes?: { page: number; bbox: [number, number, number, number] }[] | null;
  /** 公式密集块（后端 is_formula_block 判定）：hover 出「式」按钮按需 OCR 识别 LaTeX */
  formula_hint?: boolean;
  /**
   * 数学密集混合块（后端 has_heavy_math 判定，2026-09-08）：散文+行内公式，
   * 提取层已把行内数学拍平（◆/𝑥/_x_^）。与 formula_hint 同置——「式」识别
   * 结果含正文时替换原文并自动重译；同时保留「译」按钮（普通翻译路径仍可用）
   */
  math_mixed?: boolean;
}

export interface PageResult {
  page: number;
  blocks: TextBlock[];
}

export interface PipelineResult {
  job_id: string;
  status: "running" | "done" | "failed" | "unknown";
  progress: number;
  pages: PageResult[];
  error?: string | null;
}

export interface OCRJob {
  job_id: string;
  state: "pending" | "running" | "done" | "failed";
}
