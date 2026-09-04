import { create } from "zustand";

interface UiState {
  mode: "bilingual" | "inline";
  theme: "light" | "dark";
  setMode: (mode: "bilingual" | "inline") => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "bilingual",
  theme: "light",
  setMode: (mode) => set({ mode }),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),
}));
