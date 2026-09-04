import { useState, useEffect } from "react";
import { useConfigStore } from "../stores/configStore";
import { AppConfig } from "../types";
import LoadingSpinner from "./common/LoadingSpinner";

const OCR_PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow (PaddleOCR-VL-1.5) 免费" },
  { value: "baidu", label: "飞桨星河社区" },
];

const TRANSLATE_PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow (Qwen2.5-7B) 免费" },
  { value: "openai", label: "OpenAI (gpt-4o-mini)" },
  { value: "google", label: "Google Translate" },
  { value: "deepl", label: "DeepL" },
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
      <h1 className="text-2xl font-bold mb-6">API 配置</h1>

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">OCR 配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                OCR 提供商
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                placeholder="输入 API Key"
                value={form.ocr.api_key}
                onChange={(e) => updateField("ocr", "api_key", e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                OCR 模型
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={form.ocr.model}
                onChange={(e) => updateField("ocr", "model", e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                PaddleOCR-VL-1.5 默认值，可自定义
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">翻译配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                翻译提供商
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={form.translate.provider}
                onChange={(e) =>
                  updateField("translate", "provider", e.target.value)
                }
              >
                {TRANSLATE_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                placeholder="输入 API Key"
                value={form.translate.api_key}
                onChange={(e) =>
                  updateField("translate", "api_key", e.target.value)
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                翻译模型
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={form.translate.model}
                onChange={(e) =>
                  updateField("translate", "model", e.target.value)
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  源语言
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={form.translate.source_language}
                  onChange={(e) =>
                    updateField("translate", "source_language", e.target.value)
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  目标语言
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
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
