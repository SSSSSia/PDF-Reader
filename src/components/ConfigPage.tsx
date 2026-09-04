import { useState, useEffect } from "react";
import { useConfigStore } from "../stores/configStore";
import { AppConfig } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

// R8 / D3：OCR 仅 SiliconFlow 真正实现（PDF 经 PyMuPDF 转图后走 /chat/completions）。
// 飞桨星河等无后端实现，已从列表移除，避免“UI 有选项、后端无实现”的坏链接。
const OCR_PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow (PaddleOCR-VL-1.5) 免费" },
];

// 翻译：SiliconFlow 与 OpenAI 共用 OpenAI 兼容协议，后端均已实现（D3）。
// Google / DeepL 暂无独立适配器，UI 标“即将支持”并禁用，禁止静默失败。
const TRANSLATE_PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow (Qwen2.5-7B) 免费" },
  { value: "openai", label: "OpenAI (gpt-4o-mini)" },
  { value: "google", label: "Google Translate（即将支持）", available: false },
  { value: "deepl", label: "DeepL（即将支持）", available: false },
];

export default function ConfigPage() {
  const { config, saveConfig, loadConfig } = useConfigStore();
  const [form, setForm] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  if (!form) return <LoadingSpinner />;

  const updateField = (section: string, field: string, value: string) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            [section]: { ...prev[section as keyof AppConfig], [field]: value },
          }
        : prev
    );
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await saveConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 dark:text-gray-100">API 配置</h1>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 dark:text-gray-100">OCR 配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                OCR 提供商
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={form.ocr.provider}
                onChange={(e) => updateField("ocr", "provider", e.target.value)}
              >
                {OCR_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                placeholder="输入 API Key"
                value={form.ocr.api_key}
                onChange={(e) => updateField("ocr", "api_key", e.target.value)}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                注册地址:{" "}
                <a
                  href="https://siliconflow.cn"
                  target="_blank"
                  rel="noopener"
                  className="text-blue-500 underline"
                >
                  siliconflow.cn
                </a>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                OCR 模型
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={form.ocr.model}
                onChange={(e) => updateField("ocr", "model", e.target.value)}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                PaddleOCR-VL-1.5 默认值，可自定义
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 dark:text-gray-100">翻译配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                翻译提供商
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={form.translate.provider}
                onChange={(e) =>
                  updateField("translate", "provider", e.target.value)
                }
              >
                {TRANSLATE_PROVIDERS.map((p) => (
                  <option
                    key={p.value}
                    value={p.value}
                    disabled={p.available === false}
                  >
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                placeholder="输入 API Key"
                value={form.translate.api_key}
                onChange={(e) =>
                  updateField("translate", "api_key", e.target.value)
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                翻译模型
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                value={form.translate.model}
                onChange={(e) =>
                  updateField("translate", "model", e.target.value)
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  源语言
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                  value={form.translate.source_language}
                  onChange={(e) =>
                    updateField("translate", "source_language", e.target.value)
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  目标语言
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                  value={form.translate.target_language}
                  onChange={(e) =>
                    updateField("translate", "target_language", e.target.value)
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
          {saved && (
            <span className="text-green-600 self-center">✅ 已保存</span>
          )}
        </div>
      </div>
    </div>
  );
}
