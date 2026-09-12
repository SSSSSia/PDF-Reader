import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from pipeline.processor import _jobs, list_running_jobs


def test_list_running_jobs_filters_and_projects():
    _jobs.clear()
    _jobs["a"] = {"status": "running", "file_path": "x.pdf", "progress": 42}
    _jobs["b"] = {"status": "done", "file_path": "y.pdf", "progress": 100}
    _jobs["c"] = {"status": "running", "file_path": "", "progress": 0}
    out = list_running_jobs()
    assert out == [
        {"job_id": "a", "file_path": "x.pdf", "progress": 42},
        {"job_id": "c", "file_path": "", "progress": 0},
    ]
    _jobs.clear()
