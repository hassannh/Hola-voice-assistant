from __future__ import annotations

from voice_assistant.config import Settings


def test_settings_defaults():
    settings = Settings()
    assert settings.stt_model_size == "tiny"
    assert settings.enable_tools is True
    assert settings.stream_tokens is True
    assert settings.adaptive_vad is True
    assert "llama3" in settings.llm_model


def test_settings_updated():
    settings = Settings()
    updated = settings.updated(llm_model="qwen2.5:3b", tts_rate=200, wake_word="jarvis")
    assert updated.llm_model == "qwen2.5:3b"
    assert updated.tts_rate == 200
    assert updated.wake_word == "jarvis"
    # Ensure original is unchanged
    assert settings.llm_model != updated.llm_model


def test_settings_public_dict():
    settings = Settings(wake_word="assistant", enable_tools=True)
    d = settings.public_dict()
    assert d["wake_word"] == "assistant"
    assert d["enable_tools"] is True
    assert "stt_model_size" in d
    assert "adaptive_vad" in d
