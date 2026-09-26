from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Optional


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


def save_dotenv_changes(changes: dict[str, Any], path: Path | None = None) -> None:
    """Save or update environment variable values in .env."""
    env_path = path or Path(__file__).resolve().parent.parent / ".env"
    existing_lines: list[str] = []
    if env_path.is_file():
        existing_lines = env_path.read_text(encoding="utf-8").splitlines()

    updated_keys: set[str] = set()
    new_lines: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, _ = stripped.split("=", 1)
            key = key.strip()
            if key in changes:
                val = changes[key]
                if val is not None:
                    new_lines.append(f"{key}={val}")
                    os.environ[key] = str(val)
                else:
                    os.environ.pop(key, None)
                updated_keys.add(key)
                continue
        new_lines.append(line)

    for key, val in changes.items():
        if key not in updated_keys and val is not None:
            new_lines.append(f"{key}={val}")
            os.environ[key] = str(val)

    env_path.write_text("\n".join(new_lines).strip() + "\n", encoding="utf-8")


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
    llm_provider: str = "ollama"
    llm_model: str = "llama3.2:3b"
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None
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
        "You are Hola, an elite autonomous AI software engineer and pair programmer inside the Hola IDE "
        "(inspired by Antigravity, Gemini, and the ECC engineering harness).\n\n"
        "Your mission is to solve engineering tasks, explore codebases, diagnose bugs, write clean production-ready code, and verify tests autonomously.\n\n"
        "Core Engineering Operating Standard (Plan -> Research -> Test -> Implement -> Review -> Verify):\n"
        "1. Research-First Investigation: Never guess file paths, symbol names, or API signatures. Always call search_code_and_files or list_directory first, then read_code_file on targeted line ranges to verify facts before modifying code.\n"
        "2. Context Budgeting: Optimize context usage. Do not dump large files; inspect specific line ranges with start_line and end_line. Use focused grep queries.\n"
        "3. Root-Cause Isolation: When fixing bugs or exceptions, isolate the underlying root cause. Inspect call stacks and reproduction steps. Never mask errors or apply superficial band-aids.\n"
        "4. Surgical Precision: Prefer patch_code_file for targeted edits with exact matching lines. Use write_code_file only when creating new files. Never emit lazy placeholders (like '// ... rest of code ...'); write complete, robust, type-safe code.\n"
        "5. Test-Driven Verification: Verify changes with execute_terminal_command (run test suites, linters, or syntax checks) whenever applicable to guarantee zero regressions.\n"
        "6. Slash Command Directives:\n"
        "   - /plan <task>: Decompose the objective into architectural phases, risk assessment, and verification steps without making destructive edits.\n"
        "   - /test <feature>: Adopt Test-Driven Development (TDD). Propose unit tests, run tests to verify expectations, and test against edge cases.\n"
        "   - /fix <error>: Isolate root cause, inspect error lines, patch surgically, and run tests/linters to verify.\n"
        "   - /review: Conduct deep fresh-context code review for edge cases, security, performance, and maintainability.\n"
        "   - /search <query>: Conduct deep multi-source research across codebase symbols and developer web documentation.\n"
        "7. Final Synthesis: Present your final response in clear GitHub-flavored markdown with file links, diffs, and concise explanations."
    )
    exit_phrases: tuple[str, ...] = field(
        default_factory=lambda: ("exit", "quit", "stop", "goodbye")
    )
    enable_tools: bool = True
    enable_tts: bool = True
    wake_word: Optional[str] = "hola"
    stream_tokens: bool = True
    db_path: str = "assistant_history.db"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        wake = _env("VOICE_WAKE_WORD", "hola")
        api_key = _env("VOICE_LLM_API_KEY", "") or None
        base_url = _env("VOICE_LLM_BASE_URL", "") or None
        return cls(
            stt_model_size=_env("VOICE_STT_MODEL", "tiny"),
            stt_device=_env("VOICE_STT_DEVICE", "cpu"),
            stt_compute_type=_env("VOICE_STT_COMPUTE", "int8"),
            llm_provider=_env("VOICE_LLM_PROVIDER", "ollama").lower(),
            llm_model=_env("VOICE_LLM_MODEL", "llama3.2:3b"),
            llm_api_key=api_key,
            llm_base_url=base_url,
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
                cls.system_prompt,
            ),
            enable_tools=_env_bool("VOICE_ENABLE_TOOLS", True),
            enable_tts=_env_bool("VOICE_ENABLE_TTS", True),
            wake_word=wake if wake else None,
            stream_tokens=_env_bool("VOICE_STREAM_TOKENS", True),
            db_path=_env("VOICE_DB_PATH", "assistant_history.db"),
        )

    def updated(self, **changes) -> "Settings":
        return replace(self, **changes)

    def public_dict(self) -> dict:
        masked_key = ""
        if self.llm_api_key:
            k = self.llm_api_key.strip()
            if len(k) > 8:
                masked_key = f"{k[:4]}••••{k[-4:]}"
            else:
                masked_key = "••••••••"

        return {
            "stt_model_size": self.stt_model_size,
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
            "llm_api_key_masked": masked_key,
            "has_api_key": bool(self.llm_api_key and self.llm_api_key.strip()),
            "llm_base_url": self.llm_base_url or "",
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
