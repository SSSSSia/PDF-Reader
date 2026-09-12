"""BabelDOC 运行时管理（阶段9-T6 可选组件化打包）。

背景：BabelDOC 独立 venv 装完 662MB（压缩后 ~300MB）——直接打进安装包会让
体积从 ~72MB 涨到 400MB+，2026-09-11 用户决策改为「可选组件」：主安装包
不含 BabelDOC，首次使用对照功能时应用内一键下载运行时包并解压到
<data_dir>/babeldoc-runtime/，之后离线可用。

运行时包结构（scripts/build-babeldoc-runtime.ps1 产出、GitHub Release 托管）：
  babeldoc-runtime/python.exe            # python-3.12 embeddable（自包含）
  babeldoc-runtime/Lib/site-packages/    # .venv-babeldoc 全量依赖（0.6.4 锁版本）
  babeldoc-runtime/python312._pth        # 已启用 site-packages 解析
  babeldoc-runtime/runtime-version.txt   # 版本描述（状态端点透出）

安全边界：
- 本模块不接触任何 api_key；
- 下载源默认项目 GitHub Release，可用环境变量
  PDF_READER_BABELDOC_RUNTIME_URLS 覆盖（逗号分隔依次尝试，供镜像/内网）；
- 解压带 zip-slip 防护（成员路径逃逸即中止并报错）。

状态机：idle → downloading → extracting → done（error / cancelled 可重入）。
单线程安装（同一时刻至多一个），线程内写状态、外部 get_state() 快照读。
"""

import hashlib
import os
import shutil
import sys
import threading
import time
import urllib.request
import zipfile

RUNTIME_DIR_NAME = "babeldoc-runtime"
ZIP_NAME = "babeldoc-runtime.zip"
ZIP_PART_NAME = ZIP_NAME + ".part"

# 默认下载源（按国内可达性排序，依次尝试；发布时上传至各源并把真实
# namespace 写入此处——见 README「打包发布」）。国内正常网络无法直连
# GitHub，故仅作最后的海外兜底：
#   1. ModelScope 魔搭（国内直连、匿名可下、免费托管）
#   2. hf-mirror.com（HuggingFace 国内镜像）
#   3. huggingface.co（海外直连）
#   4. GitHub Release（海外兜底）
# 全部不可达时的最终出路：应用内「从本地文件安装」——用户经任何渠道
# （网盘/浏览器代理）取得 zip 后选择文件即可完成安装。
DEFAULT_URLS = [
    "https://modelscope.cn/models/SSSSSia/pdf-bilingual-reader-runtime/resolve/master/babeldoc-runtime-win64.zip",
    "https://hf-mirror.com/datasets/SSSSSia/pdf-bilingual-reader-runtime/resolve/main/babeldoc-runtime-win64.zip",
    "https://huggingface.co/datasets/SSSSSia/pdf-bilingual-reader-runtime/resolve/main/babeldoc-runtime-win64.zip",
    "https://github.com/SSSSSia/PDF-Reader/releases/download/babeldoc-runtime-v1/babeldoc-runtime-win64.zip",
]
_ENV_URLS = "PDF_READER_BABELDOC_RUNTIME_URLS"

_CHUNK = 256 * 1024
_DOWNLOAD_TIMEOUT = 30
_URL_RETRIES = 2

_lock = threading.Lock()
_cancel = threading.Event()
_state: dict = {
    "phase": "idle",  # idle | downloading | extracting | done | error | cancelled
    "downloaded": 0,
    "total": 0,
    "error": "",
    "url": "",
    "updated_at": 0.0,
}


class _Cancelled(Exception):
    """用户取消（内部控制流）。"""


def _set_state(**kw) -> None:
    with _lock:
        _state.update(kw)
        _state["updated_at"] = time.time()


def runtime_dir(data_dir: str) -> str:
    return os.path.join(data_dir, RUNTIME_DIR_NAME)


def runtime_python(data_dir: str) -> str | None:
    """应用内安装的运行时 python 路径；未安装返回 None。"""
    if sys.platform == "win32":
        p = os.path.join(runtime_dir(data_dir), "python.exe")
    else:
        p = os.path.join(runtime_dir(data_dir), "bin", "python")
    return p if os.path.isfile(p) else None


def installed_version(data_dir: str) -> str:
    """运行时版本描述（runtime-version.txt 首行）；未安装返回空串。"""
    p = os.path.join(runtime_dir(data_dir), "runtime-version.txt")
    try:
        with open(p, encoding="utf-8") as f:
            return f.readline().strip()
    except OSError:
        return ""


def get_state() -> dict:
    with _lock:
        return dict(_state)


def start_install(data_dir: str) -> dict:
    """启动在线安装（后台线程）；已有安装进行中抛 ValueError（端点转 409）。"""
    with _lock:
        if _state["phase"] in ("downloading", "extracting"):
            raise ValueError("已有安装任务进行中")
        _cancel.clear()
        _state.update(
            {
                "phase": "downloading",
                "downloaded": 0,
                "total": 0,
                "error": "",
                "url": "",
                "updated_at": time.time(),
            }
        )
    threading.Thread(target=_install_online, args=(data_dir,), daemon=True).start()
    return get_state()


def start_install_local(zip_path: str, data_dir: str) -> dict:
    """从本地 zip 安装（用户经任意渠道取得包后的兜底路径，2026-09-12 国内
    网络可达性决策）。校验是合法运行时包后走同一解压/校验链路。"""
    zip_path = (zip_path or "").strip().strip('"')
    if not zip_path or not os.path.isfile(zip_path):
        raise ValueError("zip 文件不存在")
    with _lock:
        if _state["phase"] in ("downloading", "extracting"):
            raise ValueError("已有安装任务进行中")
        _cancel.clear()
        _state.update(
            {
                "phase": "extracting",
                "downloaded": 0,
                "total": os.path.getsize(zip_path),
                "error": "",
                "url": f"本地文件 {os.path.basename(zip_path)}",
                "updated_at": time.time(),
            }
        )
    threading.Thread(
        target=_install_local_thread, args=(zip_path, data_dir), daemon=True
    ).start()
    return get_state()


def _install_local_thread(zip_path: str, data_dir: str) -> None:
    """本地安装线程体：校验/解压异常必须落到状态里（线程死亡不报错）。"""
    try:
        _install_from_zip(zip_path, data_dir, cleanup=False)
    except Exception as e:  # noqa: BLE001 —— 线程体兜底
        _set_state(phase="error", error=str(e))


def cancel_install() -> None:
    _cancel.set()


def _resolve_urls() -> list[str]:
    env = os.environ.get(_ENV_URLS, "").strip()
    if env:
        return [u.strip() for u in env.split(",") if u.strip()]
    return list(DEFAULT_URLS)


def _install_online(data_dir: str) -> None:
    """在线安装线程体：下载 → 解压 → 校验。任何失败置 error 态（可重试）。"""
    part_path = os.path.join(data_dir, ZIP_NAME) + ".part"
    os.makedirs(data_dir, exist_ok=True)
    try:
        size, _sha = _download(part_path)
        _install_from_zip(part_path, data_dir, cleanup=True)
        print(f"[babeldoc-runtime] 在线安装完成 {size / 1e6:.0f}MB")
    except _Cancelled:
        _cleanup(part_path)
        _set_state(phase="cancelled", error="")
    except Exception as e:  # noqa: BLE001 —— 线程体兜底，错误必须落到状态里
        _cleanup(part_path)
        _set_state(phase="error", error=str(e))


def _install_from_zip(zip_path: str, data_dir: str, cleanup: bool) -> None:
    """解压 + 校验（在线与本地安装共用）。cleanup=True 时接管 zip 文件生命周期。"""
    try:
        _validate_zip(zip_path)
        _extract(zip_path, data_dir)
        if not runtime_python(data_dir):
            raise RuntimeError("解压完成但未找到 python.exe，运行时包可能不完整")
        size = os.path.getsize(zip_path)
        _set_state(phase="done", downloaded=size, total=size, error="")
        print("[babeldoc-runtime] 解压安装完成")
    finally:
        if cleanup:
            _cleanup(zip_path)


def _validate_zip(zip_path: str) -> None:
    """轻校验：合法 zip 且包含运行时入口（防用户选错文件）。"""
    if not zipfile.is_zipfile(zip_path):
        raise RuntimeError("所选文件不是有效的 zip 压缩包")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    entry = f"{RUNTIME_DIR_NAME}/python.exe"
    if not any(n.replace("\\", "/") == entry for n in names):
        raise RuntimeError(
            f"压缩包内缺少 {entry}——请选择 build-babeldoc-runtime 脚本产出的运行时包"
        )


def _cleanup(part_path: str) -> None:
    try:
        os.remove(part_path)
    except OSError:
        pass


def _download(part_path: str) -> tuple[int, str]:
    """多 URL 依次尝试（每源限次重试，支持 .part 断点续传）。返回 (字节数, sha)。"""
    last_err = "无可用下载源"
    for url in _resolve_urls():
        for attempt in range(_URL_RETRIES + 1):
            if _cancel.is_set():
                raise _Cancelled()
            try:
                return _download_one(url, part_path)
            except _Cancelled:
                raise
            except Exception as e:  # noqa: BLE001 —— 重试后换下一个源
                last_err = f"{url} → {e}"
                if attempt < _URL_RETRIES:
                    time.sleep(1.0)
    raise RuntimeError(f"下载失败：{last_err}")


def _download_one(url: str, part_path: str) -> tuple[int, str]:
    """单源下载到 part 文件，边下边算 sha256 并更新进度。"""
    req = urllib.request.Request(url, headers={"User-Agent": "pdf-bilingual-reader"})
    existing = os.path.getsize(part_path) if os.path.isfile(part_path) else 0
    if existing:
        req.add_header("Range", f"bytes={existing}-")
    with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT) as resp:  # noqa: S310
        resumed = resp.status == 206 and existing > 0
        length = resp.headers.get("Content-Length")
        total = int(length) + (existing if resumed else 0) if length else 0
        sha = hashlib.sha256()
        downloaded = existing if resumed else 0
        if resumed:
            with open(part_path, "rb") as f:  # 分块补算已有部分的哈希
                while True:
                    block = f.read(4 * 1024 * 1024)
                    if not block:
                        break
                    sha.update(block)
        _set_state(url=url, total=total, downloaded=downloaded)
        with open(part_path, "ab" if resumed else "wb") as f:
            while True:
                if _cancel.is_set():
                    raise _Cancelled()
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                f.write(chunk)
                sha.update(chunk)
                downloaded += len(chunk)
                _set_state(downloaded=downloaded, total=total)
    if total and downloaded != total:
        raise RuntimeError(f"下载不完整 {downloaded}/{total}")
    return downloaded, sha.hexdigest()


def _extract(zip_path: str, data_dir: str) -> None:
    """解压到 data_dir（包内顶层即 babeldoc-runtime/），带 zip-slip 防护。"""
    root = os.path.abspath(data_dir)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            target = os.path.abspath(os.path.join(root, member.filename))
            if os.path.commonpath([root, target]) != root:
                raise RuntimeError(f"压缩包内出现非法路径：{member.filename}")
            if member.is_dir():
                os.makedirs(target, exist_ok=True)
        # 两遍法：先建目录再解文件（上面一遍已建目录），逐文件透出进度
        names = [m for m in zf.infolist() if not m.is_dir()]
        done = 0
        for member in names:
            target = os.path.abspath(os.path.join(root, member.filename))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(member) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            done += 1
            if done % 200 == 0:
                _set_state(phase="extracting", error="")
        print(f"[babeldoc-runtime] 解压完成 {done} 个文件")
