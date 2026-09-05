/**
 * Tauri / 浏览器 双模桥接层。
 *
 * 生产环境（打包后的 exe）运行在 Tauri 内，前端通过 `invoke` 与 Rust 后端通信；
 * 开发环境若用纯浏览器 `npm run dev` 做人工测试（本机无法编译 Rust 时），
 * 则自动改用 `fetch` 直连本地 Python 后端（默认 http://localhost:8000）。
 *
 * 设计约定：
 * - 所有函数对调用方返回**与 Tauri 命令一致的形态**（如 run_pipeline 返回 JSON 字符串），
 *   这样上层 useOcr / configStore 无需感知运行环境。
 * - 仅在「非 Tauri 环境」走 HTTP，且只连本地后端，不触碰任何外部 API。
 * - 是否 Tauri 以 `__TAURI_INTERNALS__` 是否存在判定。
 */
import { invoke, convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";

const API_BASE = "http://localhost:8000";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** fetch 包装：非 2xx 一律抛错（fetch 对 4xx/5xx 默认不 reject，会导致静默失败） */
async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* 非 JSON 响应，保留状态码 */
    }
    throw new Error(`后端请求失败: ${detail}`);
  }
  return r.json();
}

/** 启动流水线，返回与 Rust run_pipeline 一致的 JSON 字符串 */
export async function runPipeline(filePath: string): Promise<string> {
  if (isTauri()) {
    return (await invoke("run_pipeline", { file_path: filePath })) as string;
  }
  const r = await apiFetch(`${API_BASE}/api/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  return JSON.stringify(r);
}

/** 查询流水线状态，返回与 Rust get_pipeline_status 一致的 JSON 字符串 */
export async function getPipelineStatus(jobId: string): Promise<string> {
  if (isTauri()) {
    return (await invoke("get_pipeline_status", { job_id: jobId })) as string;
  }
  const r = await apiFetch(
    `${API_BASE}/api/pipeline/status/${encodeURIComponent(jobId)}`,
  );
  return JSON.stringify(r);
}

/** 读取配置（JSON 字符串），与 Rust load_config 一致 */
export async function loadConfig(): Promise<string> {
  if (isTauri()) {
    return (await invoke("load_config")) as string;
  }
  return JSON.stringify(await apiFetch(`${API_BASE}/api/config`));
}

/** 保存配置（参数为 JSON 字符串），与 Rust save_config 一致 */
export async function saveConfig(configStr: string): Promise<void> {
  if (isTauri()) {
    await invoke("save_config", { config_str: configStr });
    return;
  }
  await apiFetch(`${API_BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: configStr,
  });
}

/** 测试 API 连通性（经本地后端代理，规避浏览器 CORS 与 Tauri 私有网络限制） */
export interface TestSpec {
  api_url: string;
  api_key: string;
  model: string;
  mode: "text" | "ocr";
}

export async function testApiConnection(
  spec: TestSpec,
): Promise<{ status: string; model: string }> {
  if (isTauri()) {
    const r = (await invoke("test_api_connection", { spec })) as string;
    return JSON.parse(r);
  }
  return apiFetch(`${API_BASE}/api/config/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  }) as Promise<{ status: string; model: string }>;
}

/** 检查文件是否存在，与 Rust check_file_exists 一致 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  if (isTauri()) {
    return (await invoke("check_file_exists", { file_path: filePath })) as boolean;
  }
  const data = (await apiFetch(
    `${API_BASE}/api/file/exists?path=${encodeURIComponent(filePath)}`,
  )) as { exists: boolean };
  return !!data.exists;
}

/** 将文件路径转为可访问的 URL：Tauri 用 convertFileSrc，浏览器用后端原始文件接口 */
export function convertFileSrc(filePath: string): string {
  if (isTauri()) {
    return tauriConvertFileSrc(filePath);
  }
  return `${API_BASE}/api/file/raw?path=${encodeURIComponent(filePath)}`;
}

/** 本地资源（论文插图等）→ 可访问 URL；非本地路径原样返回 */
export function assetUrl(src: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("/")) {
    return convertFileSrc(src);
  }
  return src;
}

/** 打开文件选择对话框。Tauri 返回真实路径；浏览器走上传并返回服务端路径 */
export async function openFileDialog(): Promise<string | null> {
  if (isTauri()) {
    const selected = await tauriOpen({
      title: "选择 PDF 文件",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    return (selected as string | null) ?? null;
  }
  return uploadViaPicker();
}

/** 浏览器模式：把选中的 File 上传到后端，返回服务端路径（供流水线按路径读取） */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const data = (await apiFetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: form,
  })) as { path: string };
  return data.path;
}

function uploadViaPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(await uploadFile(file));
      } catch (e) {
        console.error("上传失败:", e);
        resolve(null);
      }
    };
    input.click();
  });
}
