import { create } from "zustand";

/** readerMode（阶段5-T2/D6）：original = pdfjs 原版渲染 + 块坐标译文浮层；
 *  parallel = 现有提取式对照视图（bilingual/inline 由 mode 决定）。 */
export type ReaderMode = "parallel" | "original";

interface UiState {
  mode: "bilingual" | "inline";
  theme: "light" | "dark";
  readerMode: ReaderMode;
  setMode: (mode: "bilingual" | "inline") => void;
  setTheme: (theme: "light" | "dark") => void;
  setReaderMode: (m: ReaderMode) => void;
  toggleTheme: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "bilingual",
  theme: "light",
  readerMode: "parallel",
  setMode: (mode) => set({ mode }),
  setTheme: (theme) => set({ theme }),
  setReaderMode: (readerMode) => set({ readerMode }),
  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),
}));
