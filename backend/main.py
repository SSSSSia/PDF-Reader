from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import uvicorn
import os
import sys
import json
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pipeline.processor import run_pipeline, get_pipeline_status
from config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    await settings.init()
    yield

app = FastAPI(title="PDF Bilingual Reader API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def api_health():
    """健康检查：供 Tauri 侧确认内嵌 sidecar 后端已就绪"""
    return {"status": "ok"}


@app.post("/api/config/reload")
async def api_reload_config():
    """显式刷新配置（R7）。日常处理已自动按 mtime 热更新，此端点用于保存配置后立即生效。"""
    changed = settings.refresh()
    return {"status": "ok", "changed": changed}


@app.post("/api/pipeline/run")
async def api_run_pipeline(file_path: dict):
    try:
        result = await run_pipeline(file_path["file_path"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/pipeline/status/{job_id}")
async def api_get_pipeline_status(job_id: str):
    try:
        result = await get_pipeline_status(job_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ocr/process")
async def api_ocr_process(file_path: dict):
    try:
        from ocr.siliconflow import call_ocr
        result = await call_ocr(file_path["file_path"], settings.ocr_config)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/translate/batch")
async def api_translate_batch(blocks: dict):
    try:
        from translate.base import translate_batch
        result = await translate_batch(blocks["texts"], blocks["source_lang"], blocks["target_lang"], settings.translate_config)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config")
async def api_get_config():
    """读取当前配置（与 Rust load_config 行为一致）。dev 桥接模式下前端用其加载配置。"""
    if os.path.exists(settings.config_path):
        with open(settings.config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "ocr": settings._default_ocr(),
        "translate": settings._default_translate(),
        "ui": {"default_mode": "bilingual", "theme": "light"},
    }


@app.post("/api/config")
async def api_set_config(payload: dict):
    """写入配置（与 Rust save_config 行为一致）。dev 模式前端保存配置时调用。"""
    parent = os.path.dirname(settings.config_path)
    os.makedirs(parent, exist_ok=True)
    with open(settings.config_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    settings.refresh()
    return {"status": "ok"}


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    """dev 桥接模式：浏览器无法拿到真实文件路径，故先上传到服务端临时目录，
    返回服务端绝对路径供流水线按路径读取。仅用于本地开发/测试。"""
    upload_dir = os.path.join(settings.cache_dir, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "doc.pdf")[1] or ".pdf"
    dest = os.path.join(upload_dir, f"{uuid.uuid4().hex}{ext}")
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return {"path": os.path.abspath(dest)}


@app.get("/api/file/raw")
async def api_file_raw(path: str):
    """dev 桥接模式：返回文件原始字节（缩略图用 pdfjs 通过 URL 读取）。
    仅本地开发使用，生产环境由 Tauri convertFileSrc 替代。"""
    p = path
    if not os.path.isfile(p):
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(p, media_type="application/pdf")


@app.get("/api/file/exists")
async def api_file_exists(path: str):
    return {"exists": os.path.isfile(path)}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
