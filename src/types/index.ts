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
