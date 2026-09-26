from __future__ import annotations

import logging
import threading
from typing import Callable, Optional

from voice_assistant.audio import record_audio
from voice_assistant.config import Settings
from voice_assistant.exceptions import AssistantError
from voice_assistant.llm import BaseChat
from voice_assistant.stt import WhisperTranscriber, match_wake_word
from voice_assistant.tts import PyttsxSpeaker

log = logging.getLogger(__name__)

StatusCallback = Callable[[str, Optional[str]], None]


class VoicePipeline:
    def __init__(
        self,
        settings: Settings,
        transcriber: WhisperTranscriber,
        chat: BaseChat,
        speaker: PyttsxSpeaker,
        on_event: Optional[StatusCallback] = None,
    ) -> None:
        self.settings = settings
        self._transcriber = transcriber
        self._chat = chat
        self._speaker = speaker
        self._on_event = on_event
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run_forever, name="voice-loop", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def join(self, timeout: Optional[float] = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def emit(self, kind: str, text: Optional[str] = None) -> None:
        if self._on_event:
            self._on_event(kind, text)

    def run_forever(self) -> None:
        self.emit("idle", "Ready")
        while not self._stop.is_set():
            try:
                self._turn()
            except AssistantError as exc:
                log.warning("%s", exc)
                self.emit("error", str(exc))
            except Exception:
                log.exception("Unexpected error in the voice loop")
                self.emit("error", "Unexpected error. Check the logs.")
        self.emit("stopped", "Stopped")

    def _turn(self) -> None:
        self.emit("listening", "Listening…")

        def _on_level(level: float) -> None:
            if level > 0.005:
                self.emit("audio_level", str(round(level, 4)))

        audio = record_audio(self.settings, on_level=_on_level)
        if self._stop.is_set():
            return

        self.emit("transcribing", "Transcribing…")
        raw_text = self._transcriber.transcribe(audio, self.settings.sample_rate)
        if not raw_text:
            self.emit("idle", "No speech heard")
            return

        # Wake-word verification if configured
        is_match, user_text = match_wake_word(raw_text, self.settings.wake_word)
        if not is_match:
            self.emit("idle", f"Listening for '{self.settings.wake_word}'…")
            return

        if not user_text.strip():
            self.emit("assistant", "Yes, I am listening.")
            self._speaker.speak("Yes? How can I help?")
            self.emit("idle", "Ready")
            return

        log.info("User: %s", user_text)
        self.emit("user", user_text)

        if user_text.lower().strip().rstrip(".!") in self.settings.exit_phrases:
            self._speaker.speak("Goodbye!")
            self.emit("assistant", "Goodbye!")
            self._stop.set()
            return

        self.emit("thinking", "Thinking…")

        if self.settings.stream_tokens:
            full_tokens: list[str] = []

            def on_token(token: str) -> None:
                full_tokens.append(token)
                self.emit("token", token)

            def on_tool_start(tool_name: str, tool_args: dict) -> None:
                self.emit("tool_start", f"Running tool: {tool_name}")

            sentence_generator = self._chat.stream_reply(
                user_text,
                on_token=on_token,
                on_tool_start=on_tool_start,
            )

            def on_sentence(sentence: str) -> None:
                self.emit("speaking", sentence)

            self._speaker.speak_stream(
                sentence_generator,
                stop_event=self._stop,
                on_sentence_start=on_sentence,
            )

            final_reply = "".join(full_tokens).strip()
            log.info("Assistant: %s", final_reply)
            self.emit("assistant", final_reply)
        else:
            reply = self._chat.reply(user_text)
            log.info("Assistant: %s", reply)
            self.emit("assistant", reply)
            self.emit("speaking", "Speaking…")
            self._speaker.speak(reply)

        self.emit("idle", "Ready")
