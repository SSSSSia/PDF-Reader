import { Link, useLocation } from "react-router-dom";
import { useConfigStore } from "../../stores/configStore";
import { useUiStore } from "../../stores/uiStore";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isConfigured } = useConfigStore();
  const { theme, toggleTheme, setTheme } = useUiStore();
  const location = useLocation();

  const handleToggle = async () => {
    const next = theme === "dark" ? "light" : "dark";
    toggleTheme();
    await setTheme(next);
  };

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white"
              aria-hidden="true"
            >
              译
            </span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              PDF双语阅读器
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggle}
              title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
              aria-label={theme === "dark" ? "切换到亮色" : "切换到暗色"}
              className="rounded-md px-2 py-1.5 text-base leading-none text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {theme === "dark" ? "🌞" : "🌙"}
            </button>
            <Link
              to="/config"
              aria-current={location.pathname === "/config" ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                location.pathname === "/config"
                  ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              }`}
            >
              设置
            </Link>
            {!isConfigured && (
              <span className="ml-2 hidden items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                请先配置 API Key
              </span>
            )}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
