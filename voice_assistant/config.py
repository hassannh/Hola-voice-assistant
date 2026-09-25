from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Optional


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return default if raw is None or raw.strip() == "" else int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return default if raw is None or raw.strip() == "" else float(raw)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _optional_int(name: str) -> Optional[int]:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    return int(raw)


@dataclass
class Settings:
    stt_model_size: str = "tiny"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    llm_model: str = "llama3.2:3b"
    ollama_host: str = "http://127.0.0.1:11434"
    sample_rate: int = 16000
    record_seconds: float = 5.0
    use_vad: bool = True
    adaptive_vad: bool = True
    vad_silence_seconds: float = 1.2
    vad_start_rms: float = 0.012
    max_record_seconds: float = 12.0
    tts_rate: int = 175
    input_device: Optional[int] = None
    host: str = "127.0.0.1"
    port: int = 8765
    max_history_turns: int = 20
    system_prompt: str = (
        "You are a concise, friendly personal assistant. "
        "Keep spoken replies short: one or two sentences unless asked for more."
    )
    exit_phrases: tuple[str, ...] = field(
        default_factory=lambda: ("exit", "quit", "stop", "goodbye")
    )
    enable_tools: bool = True
    wake_word: Optional[str] = None
    stream_tokens: bool = True
    db_path: str = "assistant_history.db"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        wake = _env("VOICE_WAKE_WORD", "")
        return cls(
            stt_model_size=_env("VOICE_STT_MODEL", "tiny"),
            stt_device=_env("VOICE_STT_DEVICE", "cpu"),
            stt_compute_type=_env("VOICE_STT_COMPUTE", "int8"),
            llm_model=_env("VOICE_LLM_MODEL", "llama3.2:3b"),
            ollama_host=_env("VOICE_OLLAMA_HOST", "http://127.0.0.1:11434"),
            sample_rate=_env_int("VOICE_SAMPLE_RATE", 16000),
            record_seconds=_env_float("VOICE_RECORD_SECONDS", 5.0),
            use_vad=_env_bool("VOICE_USE_VAD", True),
            adaptive_vad=_env_bool("VOICE_ADAPTIVE_VAD", True),
            vad_silence_seconds=_env_float("VOICE_VAD_SILENCE", 1.2),
            vad_start_rms=_env_float("VOICE_VAD_START_RMS", 0.012),
            max_record_seconds=_env_float("VOICE_MAX_RECORD_SECONDS", 12.0),
            tts_rate=_env_int("VOICE_TTS_RATE", 175),
            input_device=_optional_int("VOICE_INPUT_DEVICE"),
            host=_env("VOICE_HOST", "127.0.0.1"),
            port=_env_int("VOICE_PORT", 8765),
            max_history_turns=_env_int("VOICE_MAX_HISTORY", 20),
            system_prompt=_env(
                "VOICE_SYSTEM_PROMPT",
                "You are a concise, friendly personal assistant. "
                "Keep spoken replies short: one or two sentences unless asked for more.",
            ),
            enable_tools=_env_bool("VOICE_ENABLE_TOOLS", True),
            wake_word=wake if wake else None,
            stream_tokens=_env_bool("VOICE_STREAM_TOKENS", True),
            db_path=_env("VOICE_DB_PATH", "assistant_history.db"),
        )

    def updated(self, **changes) -> "Settings":
        return replace(self, **changes)

    def public_dict(self) -> dict:
        return {
            "stt_model_size": self.stt_model_size,
            "llm_model": self.llm_model,
            "ollama_host": self.ollama_host,
            "record_seconds": self.record_seconds,
            "use_vad": self.use_vad,
            "adaptive_vad": self.adaptive_vad,
            "max_record_seconds": self.max_record_seconds,
            "tts_rate": self.tts_rate,
            "input_device": self.input_device,
            "system_prompt": self.system_prompt,
            "max_history_turns": self.max_history_turns,
            "enable_tools": self.enable_tools,
            "wake_word": self.wake_word,
            "stream_tokens": self.stream_tokens,
        }
