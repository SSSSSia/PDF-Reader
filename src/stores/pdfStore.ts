import { create } from "zustand";
import { PageResult, PipelineResult } from "../types";

interface PdfState {
  file: File | null;
  filePath: string | null;
  pages: PageResult[];
  currentPage: number;
  isLoading: boolean;
  progress: number;
  error: string | null;
  result: PipelineResult | null;
  /** 当前活跃会话 key（阶段8-T1 多会话）：doc_id 或 job_id；null = 无会话。
   *  pdfStore 仅作"活跃会话"载体，非活跃会话快照存 sessionsStore。 */
  sessionKey: string | null;

  setFile: (file: File | null) => void;
  setFilePath: (path: string | null) => void;
  setPages: (pages: PageResult[]) => void;
  /** 手动单块翻译回写（2026-09-07）：按 page+block_id 定位更新译文 */
  updateBlockTranslated: (
    page: number,
    blockId: number,
    translated: string,
  ) => void;
  /**
   * 原文替换（2026-09-08）：公式混合块「式」识别后用干净 markdown
   * （英文正文+$..$ 公式）替换拍平原稿，原文栏同步变干净
   */
  updateBlockOriginal: (page: number, blockId: number, original: string) => void;
  setCurrentPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  setResult: (result: PipelineResult | null) => void;
  setSessionKey: (key: string | null) => void;
  reset: () => void;
}

export const usePdfStore = create<PdfState>((set) => ({
  file: null,
  filePath: null,
  pages: [],
  currentPage: 0,
  isLoading: false,
  progress: 0,
  error: null,
  result: null,
  sessionKey: null,

  setFile: (file) => set({ file }),
  setFilePath: (path) => set({ filePath: path }),
  setPages: (pages) => set({ pages }),
  updateBlockTranslated: (page, blockId, translated) =>
    set((state) => ({
      pages: state.pages.map((p) =>
        p.page !== page
          ? p
          : {
              ...p,
              blocks: p.blocks.map((b) =>
                b.block_id === blockId ? { ...b, translated } : b,
              ),
            },
      ),
    })),
  updateBlockOriginal: (page, blockId, original) =>
    set((state) => ({
      pages: state.pages.map((p) =>
        p.page !== page
          ? p
          : {
              ...p,
              blocks: p.blocks.map((b) =>
                b.block_id === blockId ? { ...b, original } : b,
              ),
            },
      ),
    })),
  setCurrentPage: (page) => set({ currentPage: page }),
  setLoading: (isLoading) => set({ isLoading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ result }),
  setSessionKey: (sessionKey) => set({ sessionKey }),
  reset: () =>
    set({
      file: null,
      filePath: null,
      pages: [],
      currentPage: 0,
      isLoading: false,
      progress: 0,
      error: null,
      result: null,
      sessionKey: null,
    }),
}));
