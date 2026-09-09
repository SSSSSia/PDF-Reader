import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MainPage from "./components/MainPage";
import AddArticlePage from "./components/AddArticlePage";
import ConfigPage from "./components/ConfigPage";
import BilingualPage from "./components/BilingualPage";
import InlinePage from "./components/InlinePage";
import { useConfigStore } from "./stores/configStore";
import { useUiStore } from "./stores/uiStore";
import Layout from "./components/common/Layout";
import ErrorBoundary from "./components/common/ErrorBoundary";
import LoadingSpinner from "./components/common/LoadingSpinner";

function App() {
  const { isConfigured, configLoaded, config, loadConfig } = useConfigStore();
  const { theme, setTheme } = useUiStore();

  // 阶段6-T1：启动时从 config.json（后端单一来源）灌入一次配置。
  // Key 已配置则 isConfigured 立即为真，主流程不再出现任何 Key 提示；
  // 仅当「已加载且确无 Key」时路由守卫才导向 /config。
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // 启动时用配置文件中的主题/模式初始化（来自 Rust 端落盘的 config.ui）
  useEffect(() => {
    if (config?.ui?.theme) setTheme(config.ui.theme as "light" | "dark");
  }, [config, setTheme]);

  // 主题变化即同步到 <html> 的 dark 类（Tailwind dark: 与 index.css 的 .dark body 都依赖它）
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // 阅读页守卫三态：配置未加载完不跳转（避免启动闪跳 /config），加载完且确无 Key 才导向设置
  const readerGuard = !configLoaded ? (
    <LoadingSpinner text="加载配置…" />
  ) : isConfigured ? null : (
    <Navigate to="/config" replace />
  );

  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/add" element={<AddArticlePage />} />
          <Route path="/folder/:folderId" element={<MainPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route
            path="/reader/bilingual"
            element={readerGuard ?? <BilingualPage />}
          />
          <Route
            path="/reader/inline"
            element={readerGuard ?? <InlinePage />}
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
