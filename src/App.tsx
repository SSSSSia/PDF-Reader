import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainPage from "./components/MainPage";
import ConfigPage from "./components/ConfigPage";
import BilingualPage from "./components/BilingualPage";
import InlinePage from "./components/InlinePage";
import { useConfigStore } from "./stores/configStore";
import { useUiStore } from "./stores/uiStore";
import Layout from "./components/common/Layout";
import ErrorBoundary from "./components/common/ErrorBoundary";

function App() {
  const { isConfigured, config } = useConfigStore();
  const { theme, setTheme } = useUiStore();

  // 启动时用配置文件中的主题/模式初始化（来自 Rust 端落盘的 config.ui）
  useEffect(() => {
    if (config?.ui?.theme) setTheme(config.ui.theme as "light" | "dark");
  }, [config, setTheme]);

  // 主题变化即同步到 <html> 的 dark 类（Tailwind dark: 与 index.css 的 .dark body 都依赖它）
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route
            path="/reader/bilingual"
            element={isConfigured ? <BilingualPage /> : <Navigate to="/config" />}
          />
          <Route
            path="/reader/inline"
            element={isConfigured ? <InlinePage /> : <Navigate to="/config" />}
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
