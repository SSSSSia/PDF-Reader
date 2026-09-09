import { create } from "zustand";

/** readerMode（阶段5-T2/D6）：original = pdfjs 原版渲染 + 块坐标译文浮层；
 *  parallel = 现有提取式对照视图（bilingual/inline 由 mode 决定）。 */
export type ReaderMode = "parallel" | "original";

/** 阶段7-T1 全局缩放：0.7–2.0、步进 0.1。阅读偏好（非 API 配置），
 *  按任务约定走 localStorage（`pdf-reader.zoom`），不进 config.json。 */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
const ZOOM_STORAGE_KEY = "pdf-reader.zoom";

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
}

function loadZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    const v = raw == null ? NaN : parseFloat(raw);
    if (Number.isFinite(v)) return clampZoom(v);
  } catch {
    /* localStorage 不可用的环境 → 用默认值 */
  }
  return 1;
}

function persistZoom(z: number): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
  } catch {
    /* 持久化失败不影响本会话缩放 */
  }
}

interface UiState {
  mode: "bilingual" | "inline";
  theme: "light" | "dark";
  readerMode: ReaderMode;
  zoom: number;
  setMode: (mode: "bilingual" | "inline") => void;
  setTheme: (theme: "light" | "dark") => void;
  setReaderMode: (m: ReaderMode) => void;
  setZoom: (z: number) => void;
  stepZoom: (delta: number) => void;
  resetZoom: () => void;
  toggleTheme: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "bilingual",
  theme: "light",
  readerMode: "parallel",
  zoom: loadZoom(),
  setMode: (mode) => set({ mode }),
  setTheme: (theme) => set({ theme }),
  setReaderMode: (readerMode) => set({ readerMode }),
  setZoom: (z) =>
    set(() => {
      const v = clampZoom(z);
      persistZoom(v);
      return { zoom: v };
    }),
  stepZoom: (delta) =>
    set((s) => {
      const v = clampZoom(s.zoom + delta);
      persistZoom(v);
      return { zoom: v };
    }),
  resetZoom: () =>
    set(() => {
      persistZoom(1);
      return { zoom: 1 };
    }),
  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),
}));
