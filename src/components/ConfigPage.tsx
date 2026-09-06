import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConfigStore } from "../stores/configStore";
import { usePdfStore } from "../stores/pdfStore";
import { useUiStore } from "../stores/uiStore";
import { AppConfig } from "../types";
import { testApiConnection } from "../lib/bridge";
import LoadingSpinner from "./common/LoadingSpinner";

/**
 * API 配置页 —— 交互逻辑参照 CadAgent 的 API 管理：
 * 1. 提供商「预设」下拉：选中只填充 API 地址（用户决策 2026-09-06：
 *    预设不改模型名称，模型始终用户自选；Custom 不覆盖）；
 * 2. 地址 / Key / 模型始终可编辑，Key 带显隐切换；
 * 3. 「测试连接」经本地后端代理发最小请求，内联回显结果；
 * 4. 加载时按 地址 反推预设，匹配不上落「自定义」。
 */

interface Preset {
  name: string;
  url: string;
  model: string;
  provider: string;
}

// 翻译预设（全部为 OpenAI 兼容 /chat/completions 服务；model 仅作占位不再下发）
const TRANSLATE_PRESETS: Preset[] = [
  { name: "SiliconFlow", url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Flash", provider: "openai" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1", model: "deepseek-chat", provider: "openai" },
  { name: "智谱AI", url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", provider: "openai" },
  { name: "通义千问", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", provider: "openai" },
  { name: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini", provider: "openai" },
  { name: "Moonshot", url: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", provider: "openai" },
  { name: "本地 Ollama", url: "http://localhost:11434/v1", model: "qwen3:8b", provider: "openai" },
  { name: "自定义", url: "", model: "", provider: "openai" },
];

// OCR 预设（仅收录支持视觉输入的服务，避免"选了必失败"的预设）
const OCR_PRESETS: Preset[] = [
  { name: "SiliconFlow", url: "https://api.siliconflow.cn/v1", model: "PaddlePaddle/PaddleOCR-VL-1.5", provider: "openai" },
  { name: "智谱AI", url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-plus", provider: "openai" },
  { name: "通义千问", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus", provider: "openai" },
  { name: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o", provider: "openai" },
  { name: "本地 Ollama", url: "http://localhost:11434/v1", model: "llava", provider: "openai" },
  { name: "自定义", url: "", model: "", provider: "openai" },
];

/** API Key 输入：密码态 + 显隐切换（CadAgent 的 Show/Hide 逻辑） */
function PasswordField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        type={show ? "text" : "password"}
        className="input-field flex-1"
        placeholder="sk-..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="btn-secondary w-14 shrink-0"
      >
        {show ? "隐藏" : "显示"}
      </button>
    </div>
  );
}

interface ApiSectionProps {
  title: string;
  value: { provider: string; api_key: string; api_url: string; model: string };
  presets: Preset[];
  onChange: (field: "provider" | "api_key" | "api_url" | "model", v: string) => void;
  testMode: "ocr" | "text";
  children?: React.ReactNode;
}

/** 单个 API 区块：预设下拉 + 地址/Key/模型 + 测试连接 */
function ApiSection({ title, value, presets, onChange, testMode, children }: ApiSectionProps) {
  // 只按地址反推预设（用户决策 2026-09-06：预设只改地址，模型独立选择）
  const matched = presets.findIndex((p) => p.url === value.api_url && p.url);
  const presetIndex = matched >= 0 ? matched : presets.length - 1;

  const handlePreset = (idx: number) => {
    const preset = presets[idx];
    if (!preset || preset.name === "自定义") return; // Custom 不覆盖现有值
    onChange("api_url", preset.url);
    onChange("provider", preset.provider);
    // 模型不随预设切换（用户决策：预设只改 API 地址，模型名称保持用户自选）
  };

  const [test, setTest] = useState<{
    state: "idle" | "testing" | "ok" | "fail";
    msg: string;
  }>({ state: "idle", msg: "" });

  const handleTest = async () => {
    setTest({ state: "testing", msg: "" });
    try {
      const r = await testApiConnection({
        api_url: value.api_url,
        api_key: value.api_key,
        model: value.model,
        mode: testMode,
      });
      setTest({ state: "ok", msg: `连接成功（${r.model || value.model || "未知模型"}）` });
    } catch (e) {
      setTest({ state: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const urlId = `${testMode}-url`;
  const keyId = `${testMode}-key`;
  const modelId = `${testMode}-model`;

  return (
    <section className="card p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <div className="space-y-4">
        <div>
          <label className="form-label" htmlFor={`${testMode}-preset`}>
            提供商预设
          </label>
          <select
            id={`${testMode}-preset`}
            className="input-field"
            value={presetIndex}
            onChange={(e) => handlePreset(Number(e.target.value))}
          >
            {presets.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor={urlId}>
            API 地址
          </label>
          <input
            id={urlId}
            className="input-field"
            placeholder="https://api.example.com/v1"
            value={value.api_url}
            onChange={(e) => onChange("api_url", e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor={keyId}>
            API Key
          </label>
          <PasswordField
            id={keyId}
            value={value.api_key}
            onChange={(v) => onChange("api_key", v)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor={modelId}>
            模型名称
          </label>
          <input
            id={modelId}
            className="input-field"
            placeholder="model-name"
            value={value.model}
            onChange={(e) => onChange("model", e.target.value)}
          />
        </div>
        {children}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={test.state === "testing" || !value.api_url.trim()}
            className="btn-secondary"
          >
            {test.state === "testing" ? "测试中…" : "测试连接"}
          </button>
          {test.state === "ok" && (
            <span
              role="status"
              className="animate-fade-in text-sm font-medium text-emerald-600 dark:text-emerald-400"
            >
              ✓ {test.msg}
            </span>
          )}
          {test.state === "fail" && (
            <span
              role="alert"
              className="animate-fade-in min-w-0 flex-1 truncate text-right text-sm text-red-600 dark:text-red-400"
              title={test.msg}
            >
              ✗ {test.msg}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

export default function ConfigPage() {
  const { config, saveConfig, loadConfig } = useConfigStore();
  const { pages } = usePdfStore();
  const { mode } = useUiStore();
  const navigate = useNavigate();
  const [form, setForm] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 返回目标：已有解析结果 → 回阅读页（跟随当前阅读模式）；否则回主页
  const backTarget =
    pages.length > 0 ? (mode === "inline" ? "/reader/inline" : "/reader/bilingual") : "/";

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
    // 保存前校验（参考 CadAgent：地址/模型必填，Key 允许为空以兼容本地 Ollama）
    if (!form.ocr.api_url.trim() || !form.ocr.model.trim()) {
      setError("OCR 服务需填写 API 地址与模型名称");
      return;
    }
    if (!form.translate.api_url.trim() || !form.translate.model.trim()) {
      setError("翻译服务需填写 API 地址与模型名称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-lg font-semibold text-slate-900 dark:text-slate-100">
        API 配置
      </h1>

      <div className="space-y-5">
        <ApiSection
          title="OCR 服务（图片识别）"
          value={form.ocr}
          presets={OCR_PRESETS}
          onChange={(field, v) => updateField("ocr", field, v)}
          testMode="ocr"
        />

        <ApiSection
          title="翻译服务"
          value={form.translate}
          presets={TRANSLATE_PRESETS}
          onChange={(field, v) => updateField("translate", field, v)}
          testMode="text"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="tr-source">
                源语言
              </label>
              <select
                id="tr-source"
                className="input-field"
                value={form.translate.source_language === "zh" ? "zh" : "en"}
                onChange={(e) => {
                  const v = e.target.value;
                  updateField("translate", "source_language", v);
                  // 只允许中英互译：源语言变动时，目标语言自动翻转为另一种
                  if (form.translate.target_language === v) {
                    updateField("translate", "target_language", v === "zh" ? "en" : "zh");
                  }
                }}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="tr-target">
                目标语言
              </label>
              <select
                id="tr-target"
                className="input-field"
                value={form.translate.target_language === "zh" ? "zh" : "en"}
                onChange={(e) => {
                  const v = e.target.value;
                  updateField("translate", "target_language", v);
                  if (form.translate.source_language === v) {
                    updateField("translate", "source_language", v === "zh" ? "en" : "zh");
                  }
                }}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </ApiSection>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(backTarget)}
            className="btn-secondary"
            title={backTarget === "/" ? "返回主页" : "返回阅读页"}
          >
            ← 返回
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "保存中..." : "保存配置"}
          </button>
          {saved && (
            <span
              role="status"
              className="animate-fade-in text-sm font-medium text-emerald-600 dark:text-emerald-400"
            >
              ✓ 已保存
            </span>
          )}
          {error && (
            <span
              role="alert"
              className="animate-fade-in text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
