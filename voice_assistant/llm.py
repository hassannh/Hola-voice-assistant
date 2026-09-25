from __future__ import annotations

import logging
from typing import Any, Callable, Generator, List, Optional

import ollama

from voice_assistant.config import Settings
from voice_assistant.db import Database
from voice_assistant.exceptions import LanguageModelError
from voice_assistant.ollama_status import probe_ollama
from voice_assistant.tools import ToolRegistry

log = logging.getLogger(__name__)


class OllamaChat:
    def __init__(
        self,
        settings: Settings,
        db: Optional[Database] = None,
        tools: Optional[ToolRegistry] = None,
    ) -> None:
        self._model = settings.llm_model
        self._settings = settings
        self._client = ollama.Client(host=settings.ollama_host)
        self._max_turns = settings.max_history_turns
        self.db = db or Database(settings.db_path)
        self.tools = tools or (ToolRegistry(self.db) if settings.enable_tools else None)

        self._history: list[dict[str, Any]] = [
            {"role": "system", "content": settings.system_prompt}
        ]
        self._restore_history_from_db()

    def _restore_history_from_db(self) -> None:
        """Load recent conversation turns from the SQLite database."""
        try:
            persisted = self.db.get_recent_messages(limit=self._max_turns * 2)
            for msg in persisted:
                if msg["role"] in ("user", "assistant"):
                    self._history.append({"role": msg["role"], "content": msg["content"]})
            self._trim()
        except Exception as exc:
            log.warning("Could not restore history from database: %s", exc)

    @property
    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    def reset(self, system_prompt: str | None = None) -> None:
        prompt = system_prompt if system_prompt is not None else self._history[0]["content"]
        self._history = [{"role": "system", "content": prompt}]
        try:
            self.db.clear_session()
        except Exception as exc:
            log.warning("Could not clear database session: %s", exc)

    def model_ready(self) -> bool:
        return bool(probe_ollama(self._settings).get("has_configured_model"))

    def unavailable_reply(self, user_text: str) -> str:
        return (
            f"I heard: {user_text}. The language model is not downloaded yet. "
            "Microphone and speech are working."
        )

    def _get_tools_spec(self) -> Optional[List[dict[str, Any]]]:
        if self._settings.enable_tools and self.tools:
            return self.tools.get_ollama_tools()
        return None

    def _handle_tool_calls(
        self,
        tool_calls: list[Any],
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> list[dict[str, Any]]:
        results = []
        for call in tool_calls:
            # Handle both dict and object response formats from ollama SDK
            func = call.get("function") if isinstance(call, dict) else getattr(call, "function", None)
            if not func:
                continue
            name = func.get("name") if isinstance(func, dict) else getattr(func, "name", "")
            args = func.get("arguments", {}) if isinstance(func, dict) else getattr(func, "arguments", {})
            if isinstance(args, str):
                import json
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}

            if on_tool_start:
                on_tool_start(name, args)

            log.info("Assistant triggering tool: %s(%s)", name, args)
            output = self.tools.execute(name, args) if self.tools else "Tools unavailable"

            results.append({"name": name, "output": output})
            self._history.append(
                {
                    "role": "tool",
                    "content": str(output),
                    "name": name,
                }
            )
        return results

    def stream_reply(
        self,
        user_text: str,
        on_token: Optional[Callable[[str], None]] = None,
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> Generator[str, None, None]:
        """Stream reply tokens directly from Ollama.
        Yields sentence chunks suitable for immediate TTS synthesis, while dispatching
        individual tokens via on_token.
        """
        if not self.model_ready():
            msg = self.unavailable_reply(user_text)
            if on_token:
                on_token(msg)
            yield msg
            return

        self._history.append({"role": "user", "content": user_text})
        self._trim()
        self.db.add_message(role="user", content=user_text)

        tools_spec = self._get_tools_spec()

        try:
            # First check if tool calls are requested
            if tools_spec:
                initial_resp = self._client.chat(
                    model=self._model,
                    messages=self._history,
                    tools=tools_spec,
                )
                msg_obj = initial_resp.get("message", {}) if isinstance(initial_resp, dict) else getattr(initial_resp, "message", None)
                tool_calls = msg_obj.get("tool_calls") if isinstance(msg_obj, dict) else getattr(msg_obj, "tool_calls", None)

                if tool_calls:
                    executed = self._handle_tool_calls(tool_calls, on_tool_start=on_tool_start)
                    self.db.add_message(role="assistant", content="[Executed Tools]", tool_calls=executed)

            # Stream the final answer
            response_stream = self._client.chat(
                model=self._model,
                messages=self._history,
                stream=True,
            )

            full_reply: list[str] = []
            sentence_buffer: list[str] = []
            sentence_delimiters = {".", "!", "?", "\n"}

            for chunk in response_stream:
                chunk_msg = chunk.get("message", {}) if isinstance(chunk, dict) else getattr(chunk, "message", None)
                token = chunk_msg.get("content", "") if isinstance(chunk_msg, dict) else getattr(chunk_msg, "content", "")
                if not token:
                    continue

                full_reply.append(token)
                sentence_buffer.append(token)

                if on_token:
                    on_token(token)

                # Check if we have formed a complete sentence/clause
                joined_buffer = "".join(sentence_buffer)
                if any(delim in token for delim in sentence_delimiters) and len(joined_buffer.strip()) > 15:
                    yield joined_buffer.strip()
                    sentence_buffer.clear()

            remaining = "".join(sentence_buffer).strip()
            if remaining:
                yield remaining

            final_text = "".join(full_reply).strip()
            if not final_text:
                raise LanguageModelError("The model returned an empty reply.")

            self._history.append({"role": "assistant", "content": final_text})
            self.db.add_message(role="assistant", content=final_text)

        except Exception as exc:
            if self._history and self._history[-1]["role"] == "user":
                self._history.pop()
            if isinstance(exc, LanguageModelError):
                raise
            raise LanguageModelError(
                "Could not reach Ollama. Is it running, and is the model pulled?"
            ) from exc

    def reply(self, user_text: str) -> str:
        """Synchronous wrapper around stream_reply collecting the complete output."""
        chunks = list(self.stream_reply(user_text))
        return " ".join(chunks).strip()

    def _trim(self) -> None:
        system = self._history[0:1]
        rest = self._history[1:]
        max_messages = self._max_turns * 2
        if len(rest) > max_messages:
            rest = rest[-max_messages:]
        self._history = system + rest
