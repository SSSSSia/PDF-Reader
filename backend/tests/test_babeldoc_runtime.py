"""babeldoc_runtime 单元测试（阶段9-T6 直接捆绑）：检测链各分支。"""

import os
import sys

from export import babeldoc_export, babeldoc_runtime as rt


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


def test_venv_python_chain_exe_adjacent(tmp_path, monkeypatch):
    """捆绑安装位：项目 venv 不存在时，回落到后端 exe 同级的 babeldoc-runtime/。"""
    monkeypatch.setattr(babeldoc_export, "_venv_python", lambda: None)
    exe_dir = tmp_path / "app"
    exe_dir.mkdir()
    fake_exe = exe_dir / "pdf-backend.exe"
    fake_exe.write_text("x", encoding="utf-8")
    monkeypatch.setattr(sys, "executable", str(fake_exe))
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    assert babeldoc_export.venv_python(str(data_dir)) is None

    # exe 同级出现 babeldoc-runtime/python.exe → 命中捆绑安装位
    hit = os.path.join(rt.runtime_dir(str(exe_dir)), "python.exe")
    os.makedirs(os.path.dirname(hit), exist_ok=True)
    with open(hit, "w", encoding="utf-8") as f:
        f.write("p")
    assert babeldoc_export.venv_python(str(data_dir)) == hit

    # data_dir 安装位兜底（exe 目录无运行时时）
    import shutil

    shutil.rmtree(rt.runtime_dir(str(exe_dir)))
    hit2 = os.path.join(rt.runtime_dir(str(data_dir)), "python.exe")
    os.makedirs(os.path.dirname(hit2), exist_ok=True)
    with open(hit2, "w", encoding="utf-8") as f:
        f.write("p")
    assert babeldoc_export.venv_python(str(data_dir)) == hit2
