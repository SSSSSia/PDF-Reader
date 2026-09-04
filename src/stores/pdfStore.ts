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

  setFile: (file: File | null) => void;
  setFilePath: (path: string | null) => void;
  setPages: (pages: PageResult[]) => void;
  setCurrentPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  setResult: (result: PipelineResult | null) => void;
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

  setFile: (file) => set({ file }),
  setFilePath: (path) => set({ filePath: path }),
  setPages: (pages) => set({ pages }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setLoading: (isLoading) => set({ isLoading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ result }),
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
    }),
}));
