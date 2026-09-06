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


def test_openai_compat_missing_key_returns_empty():
    cfg = {"provider": "siliconflow", "api_key": "", "api_url": "x", "model": "m"}
    out = asyncio.run(translate_text("hello", "en", "zh", cfg))
    assert out == ""


def test_batch_short_circuits_empty():
    cfg = {"provider": "siliconflow", "api_key": "", "api_url": "x", "model": "m"}
    out = asyncio.run(translate_batch(["", "  "], "en", "zh", cfg))
    assert out == ["", ""]
