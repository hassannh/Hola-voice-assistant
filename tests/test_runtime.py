from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from voice_assistant.config import Settings
from voice_assistant.runtime import AssistantRuntime


def test_runtime_lifecycle():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings = Settings(db_path=str(Path(tmpdir) / "runtime_test.db"))
        events = []

        def on_event(kind, text):
            events.append((kind, text))

        runtime = AssistantRuntime(settings, on_event=on_event)
        assert runtime.status == "idle"
        assert not runtime.is_running

        # Test settings application
        new_settings = runtime.apply_settings(wake_word="jarvis")
        assert new_settings.wake_word == "jarvis"

        # Test clear history
        runtime.clear_history()
        assert any(k == "history_cleared" for k, _ in events)


def test_runtime_chat_text_with_mock():
    with tempfile.TemporaryDirectory() as tmpdir:
        settings = Settings(db_path=str(Path(tmpdir) / "chat_test.db"))
        events = []

        def on_event(kind, text):
            events.append((kind, text))

        runtime = AssistantRuntime(settings, on_event=on_event)

        # Mock LLM and speaker to test end-to-end chat_text dispatch
        mock_chat = MagicMock()
        mock_chat.stream_reply.return_value = ["Current time is 10:00 AM."]
        runtime._chat = mock_chat

        mock_speaker = MagicMock()
        mock_speaker.speak_stream.side_effect = lambda chunks, **kw: list(chunks)
        runtime._speaker = mock_speaker
        runtime._transcriber = MagicMock()

        reply = runtime.chat_text("What time is it?", speak=True)
        assert "Current time is 10:00 AM." in reply
        mock_speaker.speak_stream.assert_called_once()
        assert any(k == "assistant" for k, _ in events)
