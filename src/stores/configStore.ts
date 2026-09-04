import { create } from "zustand";
import { AppConfig } from "../types";
import { invoke } from "@tauri-apps/api/core";

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  isConfigured: false,

  loadConfig: async () => {
    try {
      const raw = (await invoke("load_config")) as string;
      const config: AppConfig = JSON.parse(raw);
      const configured = !!(config.ocr.api_key && config.translate.api_key);
      set({ config, isConfigured: configured });
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  },

  saveConfig: async (config: AppConfig) => {
    try {
      await invoke("save_config", { config_str: JSON.stringify(config) });
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
      await invoke("save_config", { config_str: JSON.stringify(updated) });
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
