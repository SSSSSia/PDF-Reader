import { create } from "zustand";
import { AppConfig } from "../types";
import { loadConfig, saveConfig } from "../lib/bridge";

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  isConfigured: false,

  loadConfig: async () => {
    try {
      const raw = (await loadConfig()) as string;
      const config: AppConfig = JSON.parse(raw);
      const configured = !!(config.ocr.api_key && config.translate.api_key);
      set({ config, isConfigured: configured });
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  },

  saveConfig: async (config: AppConfig) => {
    try {
      await saveConfig(JSON.stringify(config));
      const configured = !!(config.ocr.api_key && config.translate.api_key);
      set({ config, isConfigured: configured });
    } catch (e) {
      console.error("Failed to save config:", e);
      throw e;
    }
  },

  setTheme: async (theme: "light" | "dark") => {
    const cur = get().config;
    if (!cur) return;
    const updated: AppConfig = { ...cur, ui: { ...cur.ui, theme } };
    try {
      await saveConfig(JSON.stringify(updated));
      set({ config: updated });
    } catch (e) {
      console.error("Failed to save theme:", e);
    }
  },
}));

interface ConfigState {
  config: AppConfig | null;
  isConfigured: boolean;
  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
  setTheme: (theme: "light" | "dark") => Promise<void>;
}
