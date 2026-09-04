import { Link, useLocation } from "react-router-dom";
import { useConfigStore } from "../../stores/configStore";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isConfigured } = useConfigStore();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <Link to="/" className="text-xl font-bold text-blue-600">
            PDF双语阅读器
          </Link>
          <div className="flex gap-4 items-center">
            <Link
              to="/config"
              className={`px-3 py-1 rounded text-sm ${
                location.pathname === "/config"
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-600 hover:text-blue-600"
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
