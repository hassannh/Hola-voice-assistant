from __future__ import annotations

import threading
from typing import Callable, Iterable, Optional

import pyttsx3

from voice_assistant.config import Settings
from voice_assistant.exceptions import TextToSpeechError


class PyttsxSpeaker:
    """Offline TTS. Engine is created on the speaking thread (pyttsx3 is picky)."""

    def __init__(self, settings: Settings) -> None:
        self._rate = settings.tts_rate
        self._engine = None
        self._thread_id: int | None = None

    def set_rate(self, rate: int) -> None:
        self._rate = rate
        if self._engine is not None and self._thread_id == threading.get_ident():
            self._engine.setProperty("rate", rate)

    def _ensure_engine(self) -> None:
        ident = threading.get_ident()
        if self._engine is not None and self._thread_id == ident:
            return
        try:
            self._engine = pyttsx3.init()
            self._engine.setProperty("rate", self._rate)
            self._thread_id = ident
        except Exception as exc:
            raise TextToSpeechError(
                "Could not start the speech engine. On Linux install espeak-ng."
            ) from exc

    def speak(self, text: str) -> None:
        if not text:
            return
        self._ensure_engine()
        try:
            self._engine.say(text)
            self._engine.runAndWait()
        except Exception as exc:
            raise TextToSpeechError("Could not speak the reply.") from exc

    def speak_stream(
        self,
        chunks,
        stop_event: Optional[threading.Event] = None,
        on_sentence_start: Optional[Callable[[str], None]] = None,
    ) -> None:
        for sentence in chunks:
            if stop_event and stop_event.is_set():
                break
            clean = sentence.strip()
            if not clean:
                continue
            if on_sentence_start:
                try:
                    on_sentence_start(clean)
                except Exception:
                    pass
            self.speak(clean)

    def list_voices(self) -> list[str]:
        self._ensure_engine()
        voices = self._engine.getProperty("voices") or []
        return [getattr(voice, "name", str(voice)) for voice in voices]
