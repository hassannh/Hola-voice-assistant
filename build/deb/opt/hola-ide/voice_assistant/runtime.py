from __future__ import annotations

import logging
from typing import Callable, Optional

from voice_assistant.config import Settings, save_dotenv_changes
from voice_assistant.db import Database
from voice_assistant.llm import BaseChat, create_chat_client
from voice_assistant.pipeline import VoicePipeline
from voice_assistant.stt import WhisperTranscriber
from voice_assistant.tools import ToolRegistry
from voice_assistant.tts import PyttsxSpeaker

log = logging.getLogger(__name__)


class AssistantRuntime:
    """Owns settings, database persistence, tools, and the live pipeline.
    Safe to drive from CLI or the dashboard.
    """

    def __init__(self, settings: Settings, on_event: Optional[Callable] = None) -> None:
        self.settings = settings
        self._on_event = on_event
        self.db = Database(settings.db_path)
        self.tools = ToolRegistry(self.db) if settings.enable_tools else None
        self._transcriber: Optional[WhisperTranscriber] = None
        self._chat: Optional[BaseChat] = None
        self._speaker: Optional[PyttsxSpeaker] = None
        self.pipeline: Optional[VoicePipeline] = None
        self.status = "idle"
        self.last_error: Optional[str] = None

    def set_event_handler(self, handler: Callable) -> None:
        self._on_event = handler

    def apply_settings(self, **changes) -> Settings:
        if self.is_running:
            raise RuntimeError("Stop the assistant before changing settings.")

        # Ignore masked or empty password submissions when key already exists
        if "llm_api_key" in changes:
            key_val = changes["llm_api_key"]
            if not key_val or "••••" in key_val or "***" in key_val:
                changes.pop("llm_api_key")

        self.settings = self.settings.updated(**changes)

        # Persist updated core settings to .env
        env_updates: dict[str, str] = {}
        if "llm_provider" in changes:
            env_updates["VOICE_LLM_PROVIDER"] = self.settings.llm_provider
        if "llm_model" in changes:
            env_updates["VOICE_LLM_MODEL"] = self.settings.llm_model
        if "llm_api_key" in changes and self.settings.llm_api_key:
            env_updates["VOICE_LLM_API_KEY"] = self.settings.llm_api_key
        if "llm_base_url" in changes:
            env_updates["VOICE_LLM_BASE_URL"] = self.settings.llm_base_url or ""
        if "stt_model_size" in changes:
            env_updates["VOICE_STT_MODEL"] = self.settings.stt_model_size
        if "tts_rate" in changes:
            env_updates["VOICE_TTS_RATE"] = str(self.settings.tts_rate)
        if env_updates:
            try:
                save_dotenv_changes(env_updates)
            except Exception as exc:
                log.warning("Could not persist settings to .env: %s", exc)

        # Update tools registry if setting toggled
        if self.settings.enable_tools and self.tools is None:
            self.tools = ToolRegistry(self.db)
        elif not self.settings.enable_tools:
            self.tools = None

        # Force reload so STT/LLM/TTS pick up the new values.
        self._transcriber = None
        self._chat = None
        self._speaker = None
        return self.settings

    @property
    def is_running(self) -> bool:
        return self.pipeline is not None and self.pipeline.running

    def ensure_chat(self) -> None:
        if self._chat is None:
            self._chat = create_chat_client(self.settings, db=self.db, tools=self.tools)

    def ensure_speaker(self) -> None:
        if self._speaker is None:
            self._speaker = PyttsxSpeaker(self.settings)
            self._speaker.set_rate(self.settings.tts_rate)

    def ensure_loaded(self) -> None:
        if self._transcriber is None:
            log.info("Loading speech-to-text model (%s)…", self.settings.stt_model_size)
            self._transcriber = WhisperTranscriber(self.settings)
        self.ensure_chat()
        self.ensure_speaker()

    def start(self) -> None:
        self.ensure_loaded()
        assert self._transcriber and self._chat and self._speaker
        self.last_error = None
        self.pipeline = VoicePipeline(
            settings=self.settings,
            transcriber=self._transcriber,
            chat=self._chat,
            speaker=self._speaker,
            on_event=self._handle_event,
        )
        self.pipeline.start()
        self.status = "running"

    def stop(self) -> None:
        if self.pipeline is not None:
            self.pipeline.stop()
        self.status = "stopped"

    def history(self) -> list[dict]:
        if self._chat is not None:
            return self._chat.history
        return self.db.get_recent_messages(limit=self.settings.max_history_turns * 2)

    def clear_history(self) -> None:
        if self._chat is not None:
            self._chat.reset()
        else:
            self.db.clear_session()
        self._handle_event("history_cleared", "Conversation history cleared.")

    def get_tools(self) -> list[dict]:
        if not self.tools:
            return []
        return [
            {"name": t.name, "description": t.description}
            for t in self.tools.tools.values()
        ]

    def chat_text(self, text: str, speak: bool = False) -> str:
        """Process typed text directly through the agent runtime."""
        self.ensure_chat()
        if speak:
            self.ensure_speaker()
        assert self._chat

        self._handle_event("user", text)
        self._handle_event("thinking", "Thinking…")

        full_tokens: list[str] = []

        def on_token(token: str) -> None:
            full_tokens.append(token)
            self._handle_event("token", token)

        def on_tool(name: str, args: dict) -> None:
            self._handle_event("tool_start", f"Running tool: {name}")

        generator = self._chat.stream_reply(text, on_token=on_token, on_tool_start=on_tool)

        yielded_chunks: list[str] = []

        def _chunk_collector():
            for chunk in generator:
                yielded_chunks.append(chunk)
                yield chunk

        if speak:
            self._speaker.speak_stream(_chunk_collector())
        else:
            list(_chunk_collector())

        final_reply = "".join(full_tokens).strip() or " ".join(yielded_chunks).strip()
        self._handle_event("assistant", final_reply)
        self._handle_event("idle", "Ready")
        return final_reply

    def _handle_event(self, kind: str, text: Optional[str]) -> None:
        self.status = kind
        if kind == "error":
            self.last_error = text
        if self._on_event:
            self._on_event(kind, text)
