"""babeldoc_runtime 单元测试（阶段9-T6）：检测链 / zip 校验 / zip-slip / 状态机。"""

import io
import os
import time
import zipfile

import pytest

from export import babeldoc_runtime as rt


@pytest.fixture()
def reset_state():
    """用例间复位模块级安装状态（单例，测试互不污染）。"""
    rt._set_state(phase="idle", downloaded=0, total=0, error="", url="")
    rt._cancel.clear()
    yield
    rt._set_state(phase="idle", downloaded=0, total=0, error="", url="")
    rt._cancel.clear()


def _make_runtime_zip(path, root="babeldoc-runtime"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{root}/python.exe", "fake-python")
        zf.writestr(f"{root}/runtime-version.txt", "babeldoc-0.6.4 py3.12\n")
        zf.writestr(f"{root}/Lib/site-packages/mini/__init__.py", "")
    with open(path, "wb") as f:
        f.write(buf.getvalue())


def test_runtime_python_detection(tmp_path):
    assert rt.runtime_python(str(tmp_path)) is None
    exe = os.path.join(rt.runtime_dir(str(tmp_path)), "python.exe")
    os.makedirs(os.path.dirname(exe), exist_ok=True)
    with open(exe, "w", encoding="utf-8") as f:
        f.write("x")
    assert rt.runtime_python(str(tmp_path)) == exe


def test_installed_version(tmp_path):
    assert rt.installed_version(str(tmp_path)) == ""
    d = rt.runtime_dir(str(tmp_path))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "runtime-version.txt"), "w", encoding="utf-8") as f:
        f.write("babeldoc-0.6.4 py3.12\n")
    assert rt.installed_version(str(tmp_path)) == "babeldoc-0.6.4 py3.12"


def test_install_local_full_flow(tmp_path):
    """本地 zip 安装全流程：解压 → python.exe 就位 → 版本可读 → done 态。"""
    zip_path = tmp_path / "runtime.zip"
    _make_runtime_zip(str(zip_path))
    data_dir = tmp_path / "data"
    st = rt.start_install_local(str(zip_path), str(data_dir))
    assert st["phase"] == "extracting"
    for _ in range(100):
        if rt.get_state()["phase"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert rt.get_state()["phase"] == "done"
    assert rt.runtime_python(str(data_dir)) is not None
    assert "babeldoc-0.6.4" in rt.installed_version(str(data_dir))


def test_install_local_rejects_non_runtime_zip(tmp_path):
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("random.txt", "x")
    data_dir = tmp_path / "data"
    rt.start_install_local(str(bad), str(data_dir))
    for _ in range(100):
        if rt.get_state()["phase"] in ("done", "error"):
            break
        time.sleep(0.05)
    st = rt.get_state()
    assert st["phase"] == "error"
    assert "运行时包" in st["error"]


def test_install_local_missing_file(tmp_path):
    with pytest.raises(ValueError):
        rt.start_install_local(str(tmp_path / "nope.zip"), str(tmp_path))


def test_zip_slip_guard(tmp_path):
    """恶意 zip（成员路径逃逸）必须被拒绝，不得写出 data_dir 之外。"""
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as zf:
        zf.writestr("../escaped.txt", "x")
        zf.writestr("babeldoc-runtime/python.exe", "p")
    data_dir = tmp_path / "data"
    rt.start_install_local(str(evil), str(data_dir))
    for _ in range(100):
        if rt.get_state()["phase"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert rt.get_state()["phase"] == "error"
    assert not (tmp_path / "escaped.txt").exists()


def test_concurrent_install_guard(tmp_path, monkeypatch):
    """进行中重复启动 → 409（ValueError）；不可达源最终落 error 态。"""
    monkeypatch.setenv(rt._ENV_URLS, "http://127.0.0.1:9/none.zip")
    data_dir = tmp_path / "data"
    rt.start_install(str(data_dir))
    with pytest.raises(ValueError):
        rt.start_install(str(data_dir))
    for _ in range(300):
        if rt.get_state()["phase"] == "error":
            break
        time.sleep(0.05)
    assert rt.get_state()["phase"] == "error"


def test_cancel_install(reset_state, tmp_path, monkeypatch):
    """取消：下载重试间隙响应取消 → cancelled 态。"""
    monkeypatch.setenv(rt._ENV_URLS, "http://127.0.0.1:9/none.zip")
    rt.start_install(str(tmp_path / "data"))
    rt.cancel_install()
    for _ in range(300):
        if rt.get_state()["phase"] == "cancelled":
            break
        time.sleep(0.05)
    assert rt.get_state()["phase"] == "cancelled"
