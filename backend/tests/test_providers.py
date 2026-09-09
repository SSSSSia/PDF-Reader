import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from translate.base import translate_batch, translate_text
from translate.providers import get_provider, list_providers
from translate.providers.deepl import DeepLProvider
from translate.providers.google import GoogleProvider


def _fake_response(json_data, status_code=200):
    class _R:
        def raise_for_status(self):
            return None

        def json(self):
            return json_data

    r = _R()
    r.status_code = status_code
    r.text = ""
    return r


def test_empty_text_returns_empty():
    out = asyncio.run(translate_text("", "en", "zh", {"provider": "siliconflow"}))
    assert out == ""


def test_unknown_provider_raises():
    with pytest.raises(ValueError):
        get_provider("does-not-exist")


def test_unimplemented_providers_raise():
    with pytest.raises(NotImplementedError):
        asyncio.run(GoogleProvider().translate("x", "en", "zh", {}))
    with pytest.raises(NotImplementedError):
        asyncio.run(DeepLProvider().translate("x", "en", "zh", {}))


def test_list_providers_flags():
    flags = list_providers()
    assert flags["siliconflow"] is True
    assert flags["openai"] is True
    assert flags["google"] is False
    assert flags["deepl"] is False


def test_openai_compat_call_mocked():
    cfg = {
        "provider": "siliconflow",
        "api_url": "https://example/v1",
        "api_key": "test-key",
        "model": "test-model",
    }
    fake = {"choices": [{"message": {"content": "你好世界"}}]}
    with patch(
        "translate.providers.openai_compat.httpx.AsyncClient.post",
        new=AsyncMock(return_value=_fake_response(fake)),
    ):
        out = asyncio.run(translate_text("hello world", "en", "zh", cfg))
    assert out == "你好世界"


def test_openai_compat_missing_key_raises():
    """无 Key 显式报错（2026-09-09）：不再静默返回空译文。"""
    cfg = {"provider": "siliconflow", "api_key": "", "api_url": "x", "model": "m"}
    with pytest.raises(ValueError, match="翻译 API Key 未配置"):
        asyncio.run(translate_text("hello", "en", "zh", cfg))


def test_batch_short_circuits_empty():
    cfg = {"provider": "siliconflow", "api_key": "", "api_url": "x", "model": "m"}
    out = asyncio.run(translate_batch(["", "  "], "en", "zh", cfg))
    assert out == ["", ""]


# ── 批次分隔标记协议（2026-09-08：Qwen3-8B 整批连译、标记全丢实测）──────

from translate.providers.openai_compat import (
    PROMPT_VERSION,
    _system_prompt,
)


def test_system_prompt_contains_batch_marker_protocol():
    """批次合并翻译依赖模型回显 <<<n>>> 标记，协议必须写进提示词。"""
    prompt = _system_prompt("en", "zh", {})
    assert "<<<0>>>" in prompt
    assert "分隔标记" in prompt
    assert "不得合并段落" in prompt


def test_prompt_version_bumped_for_batch_protocol():
    assert PROMPT_VERSION == "pv5"
