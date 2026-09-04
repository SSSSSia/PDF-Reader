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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <Link
            to="/"
            className="text-xl font-bold text-blue-600 dark:text-blue-400"
          >
            PDF双语阅读器
          </Link>
          <div className="flex gap-4 items-center">
            <button
              onClick={handleToggle}
              title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
              className="px-2 py-1 rounded text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {theme === "dark" ? "🌞" : "🌙"}
            </button>
            <Link
              to="/config"
              className={`px-3 py-1 rounded text-sm ${
                location.pathname === "/config"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                  : "text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
              }`}
            >
              设置
            </Link>
            {!isConfigured && (
              <span className="text-orange-500 text-sm">⚠️ 请先配置API Key</span>
            )}
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
