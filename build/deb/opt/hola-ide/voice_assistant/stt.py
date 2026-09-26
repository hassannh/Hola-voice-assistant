from __future__ import annotations

from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from voice_assistant.config import Settings
from voice_assistant.exceptions import SpeechToTextError


class WhisperTranscriber:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = WhisperModel(
            settings.stt_model_size,
            device=settings.stt_device,
            compute_type=settings.stt_compute_type,
        )

    def transcribe(self, audio: np.ndarray, sample_rate: int) -> str:
        if audio.size == 0:
            return ""
        audio_float = audio.flatten().astype(np.float32) / 32768.0
        try:
            segments, _info = self._model.transcribe(
                audio_float,
                language=None,
                vad_filter=self.settings.use_vad,
                vad_parameters=dict(min_silence_duration_ms=400),
            )
            return " ".join(segment.text for segment in segments).strip()
        except Exception as exc:
            raise SpeechToTextError("Speech-to-text failed.") from exc


def match_wake_word(text: str, wake_word: Optional[str]) -> tuple[bool, str]:
    """Check if the transcribed speech contains the configured wake word.
    Returns (is_match, remainder_text).
    """
    if not wake_word or not wake_word.strip():
        return True, text

    norm_text = text.lower().strip()
    norm_wake = wake_word.lower().strip()

    if norm_wake in norm_text:
        # Strip wake word and any leading punctuation
        idx = norm_text.find(norm_wake)
        remainder = text[idx + len(norm_wake) :].lstrip(" ,.!?")
        return True, remainder
    return False, text
