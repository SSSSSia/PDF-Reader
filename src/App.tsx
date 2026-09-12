import { useEffect, useRef, useState } from "react";
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
import ConfirmDialog from "./components/common/ConfirmDialog";
import { logFrontend, listRunningTranslations, listRunningExports } from "./lib/bridge";
import { attach, currentTranslationKey } from "./lib/translationManager";
import { useBabelDocStore } from "./stores/babeldocStore";

function App() {
  const { isConfigured, configLoaded, config, loadConfig } = useConfigStore();
  const { theme, setTheme } = useUiStore();

  // 全局错误上报：渲染外未捕获的异常/Promise 拒绝落到后端 frontend.log，
  // 打包 exe 无控制台时这是排查"页面崩溃"的主要线索（2026-09-09 用户反馈崩溃）
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      logFrontend(
        "error",
        `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason);
      logFrontend("error", `unhandledrejection: ${reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

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

  // 阶段11-T5 翻译任务自动重接管：F5 整页重载后前端 job_id 丢失，后端任务
  // 孤儿化继续跑。配置加载完成后查一次 running 列表，发现未完成任务弹自绘
  // 确认，确认后 attach 恢复进度与流式渲染；忽略/无任务均不打扰。
  const [reattach, setReattach] = useState<{
    jobId: string;
    filePath: string;
    fileName: string;
    progress: number;
  } | null>(null);
  const reattachChecked = useRef(false);
  useEffect(() => {
    if (!configLoaded || reattachChecked.current) return;
    reattachChecked.current = true;
    const discover = async (attempt: number): Promise<void> => {
      if (currentTranslationKey()) return;
      try {
        const [pipeline, exports] = await Promise.all([
          listRunningTranslations(),
          listRunningExports(),
        ]);
        // BabelDOC 运行中：静默重接管（无需用户决策，进度卡在其模式内呈现；
        // 用户点忽略也不丢——任务照跑，产物完成自动落缓存）
        const ex = exports[0];
        if (ex) {
          useBabelDocStore
            .getState()
            .reattachRunning(ex.job_id, ex.file_path, Math.round(ex.progress));
        }
        // 翻译运行中：弹确认（接管会改变当前阅读视图，需用户点头）
        if (pipeline.length > 0 && !currentTranslationKey()) {
          const j = pipeline[0];
          const fileName = (j.file_path.split(/[\\/]/).pop() ?? "文档").replace(
            /\.pdf$/i,
            "",
          );
          setReattach({
            jobId: j.job_id,
            filePath: j.file_path,
            fileName,
            progress: Math.round(j.progress),
          });
        }
      } catch {
        // 后端未就绪（浏览器模式手动启动等）：最多再等两轮
        if (attempt < 2) {
          setTimeout(() => void discover(attempt + 1), 5000);
        }
      }
    };
    void discover(0);
  }, [configLoaded]);

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
      <ConfirmDialog
        open={reattach !== null}
        title="检测到未完成的翻译"
        description={
          reattach
            ? `「${reattach.fileName}」仍在后台翻译中（当前 ${reattach.progress}%）。继续后将恢复进度与实时译文，已翻译内容不会重复计费。`
            : ""
        }
        confirmText="继续翻译"
        cancelText="忽略"
        onConfirm={() => {
          if (!reattach) return;
          const r = attach(reattach.jobId, reattach.filePath);
          if (r.ok) setReattach(null);
          // 接管失败（理论上仅并发接管冲突）保留弹窗可再次确认
        }}
        onCancel={() => setReattach(null)}
      />
    </ErrorBoundary>
  );
}

export default App;
