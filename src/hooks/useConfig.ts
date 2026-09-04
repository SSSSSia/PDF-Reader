import { useEffect } from "react";
import { useConfigStore } from "../stores/configStore";

export function useConfig() {
  const { isConfigured, loadConfig } = useConfigStore();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return { isConfigured };
}
