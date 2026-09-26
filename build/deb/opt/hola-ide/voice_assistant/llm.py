from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Generator, List, Optional

import httpx
import ollama

from voice_assistant.config import Settings
from voice_assistant.db import Database
from voice_assistant.exceptions import LanguageModelError
from voice_assistant.ollama_status import probe_ollama
from voice_assistant.tools import ToolRegistry

log = logging.getLogger(__name__)

# Registry of supported providers with metadata and defaults
PROVIDER_REGISTRY: dict[str, dict[str, Any]] = {
    "ollama": {
        "id": "ollama",
        "name": "Ollama (Local)",
        "badge": "🦙 Local",
        "default_model": "llama3.2:3b",
        "default_base_url": "http://127.0.0.1:11434",
        "requires_key": False,
        "key_hint": "No API key needed (runs locally)",
        "models": [
            "llama3.2:3b",
            "llama3.2:1b",
            "llama3.1:8b",
            "mistral:7b",
            "qwen2.5:7b",
            "deepseek-r1:8b",
            "phi3:mini",
        ],
    },
    "groq": {
        "id": "groq",
        "name": "Groq (Ultra-Fast)",
        "badge": "⚡ Ultra-Fast",
        "default_model": "openai/gpt-oss-120b",
        "default_base_url": "https://api.groq.com/openai/v1",
        "requires_key": True,
        "key_hint": "gsk_...",
        "models": [
            "openai/gpt-oss-120b",
            "qwen/qwen3.6-27b",
            "gemma2-9b-it",
            "deepseek-r1-distill-llama-70b",
            "compound-beta",
            "compound-beta-mini",
        ],
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "badge": "🟢 OpenAI",
        "default_model": "gpt-4o-mini",
        "default_base_url": "https://api.openai.com/v1",
        "requires_key": True,
        "key_hint": "sk-...",
        "models": [
            "gpt-4o-mini",
            "gpt-4o",
            "o3-mini",
            "gpt-4-turbo",
        ],
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic Claude",
        "badge": "🟣 Claude",
        "default_model": "claude-3-5-haiku-20241022",
        "default_base_url": "https://api.anthropic.com/v1",
        "requires_key": True,
        "key_hint": "sk-ant-...",
        "models": [
            "claude-3-5-haiku-20241022",
            "claude-3-5-sonnet-20241022",
            "claude-3-opus-20240229",
        ],
    },
    "gemini": {
        "id": "gemini",
        "name": "Google Gemini",
        "badge": "🔷 Gemini",
        "default_model": "gemini-2.0-flash",
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "requires_key": True,
        "key_hint": "AIza...",
        "models": [
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ],
    },
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter (Any Model)",
        "badge": "🌐 OpenRouter",
        "default_model": "meta-llama/llama-3.3-70b-instruct",
        "default_base_url": "https://openrouter.ai/api/v1",
        "requires_key": True,
        "key_hint": "sk-or-...",
        "models": [
            "meta-llama/llama-3.3-70b-instruct",
            "google/gemini-2.0-flash-exp:free",
            "deepseek/deepseek-chat",
            "anthropic/claude-3.5-sonnet",
            "openai/gpt-4o-mini",
        ],
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "badge": "🐋 DeepSeek",
        "default_model": "deepseek-chat",
        "default_base_url": "https://api.deepseek.com/v1",
        "requires_key": True,
        "key_hint": "sk-...",
        "models": [
            "deepseek-chat",
            "deepseek-reasoner",
        ],
    },
    "custom": {
        "id": "custom",
        "name": "Custom (OpenAI Compatible)",
        "badge": "⚙️ Custom",
        "default_model": "default",
        "default_base_url": "http://localhost:8000/v1",
        "requires_key": False,
        "key_hint": "Optional API Key",
        "models": [],
    },
}


class BaseChat:
    """Base interface for all conversational LLM backends."""

    def __init__(
        self,
        settings: Settings,
        db: Optional[Database] = None,
        tools: Optional[ToolRegistry] = None,
    ) -> None:
        self._settings = settings
        self._model = settings.llm_model
        self._max_turns = settings.max_history_turns
        self.db = db or Database(settings.db_path)
        self.tools = tools or (ToolRegistry(self.db) if settings.enable_tools else None)

        self._history: list[dict[str, Any]] = [
            {"role": "system", "content": settings.system_prompt}
        ]
        self._restore_history_from_db()

    def _restore_history_from_db(self) -> None:
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
        raise NotImplementedError

    def unavailable_reply(self, user_text: str) -> str:
        raise NotImplementedError

    def stream_reply(
        self,
        user_text: str,
        on_token: Optional[Callable[[str], None]] = None,
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> Generator[str, None, None]:
        raise NotImplementedError

    def reply(self, user_text: str) -> str:
        chunks = list(self.stream_reply(user_text))
        return " ".join(chunks).strip()

    def _trim(self) -> None:
        system = self._history[0:1]
        rest = self._history[1:]
        max_messages = self._max_turns * 2
        if len(rest) > max_messages:
            rest = rest[-max_messages:]
        self._history = system + rest

    def _get_tools_spec(self) -> Optional[List[dict[str, Any]]]:
        if self._settings.enable_tools and self.tools:
            return self.tools.get_ollama_tools()
        return None


class OllamaChat(BaseChat):
    """Local Ollama backend implementation."""

    def __init__(
        self,
        settings: Settings,
        db: Optional[Database] = None,
        tools: Optional[ToolRegistry] = None,
    ) -> None:
        super().__init__(settings, db=db, tools=tools)
        self._client = ollama.Client(host=settings.ollama_host)

    def model_ready(self) -> bool:
        return bool(probe_ollama(self._settings).get("has_configured_model"))

    def unavailable_reply(self, user_text: str) -> str:
        return (
            f"I heard: {user_text}. The local Ollama model '{self._model}' is not downloaded yet. "
            "Please click 'Download Model' in the dashboard or run `ollama pull`."
        )

    def _handle_tool_calls(
        self,
        tool_calls: list[Any],
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> list[dict[str, Any]]:
        results = []
        for call in tool_calls:
            func = call.get("function") if isinstance(call, dict) else getattr(call, "function", None)
            if not func:
                continue
            name = func.get("name") if isinstance(func, dict) else getattr(func, "name", "")
            args = func.get("arguments", {}) if isinstance(func, dict) else getattr(func, "arguments", {})
            if isinstance(args, str):
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
                f"Could not reach Ollama: {exc}"
            ) from exc


class OpenAICompatibleChat(BaseChat):
    """Universal OpenAI-compatible chat client.
    Supports Groq, OpenAI, Google Gemini, OpenRouter, DeepSeek, and custom endpoints.
    """

    def __init__(
        self,
        settings: Settings,
        db: Optional[Database] = None,
        tools: Optional[ToolRegistry] = None,
    ) -> None:
        super().__init__(settings, db=db, tools=tools)
        provider = settings.llm_provider.lower()
        meta = PROVIDER_REGISTRY.get(provider, PROVIDER_REGISTRY["custom"])

        self._provider = provider
        self._api_key = settings.llm_api_key or ""
        if provider == "custom":
            self._base_url = (settings.llm_base_url or meta.get("default_base_url", "http://localhost:8000/v1")).rstrip("/")
        else:
            self._base_url = meta.get("default_base_url", "https://api.openai.com/v1").rstrip("/")
        self._model = settings.llm_model or meta.get("default_model", "gpt-4o-mini")
        self._requires_key = meta.get("requires_key", True)

    def model_ready(self) -> bool:
        if self._requires_key:
            return bool(self._api_key and self._api_key.strip())
        return bool(self._base_url and self._model)

    def unavailable_reply(self, user_text: str) -> str:
        return (
            f"I heard: {user_text}. An API key for provider '{self._provider.upper()}' is not configured yet. "
            "Please enter your API key in the dashboard Settings."
        )

    def _get_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key.strip()}"
        if self._provider == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/hassannh/Hola-voice-assistant"
            headers["X-Title"] = "Hola Voice Assistant"
        return headers

    def _handle_tool_calls(
        self,
        tool_calls: list[Any],
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> list[dict[str, Any]]:
        results = []
        for call in tool_calls:
            call_id = call.get("id", f"call_{int(time.time()*1000)}")
            func = call.get("function", {})
            name = func.get("name", "")
            raw_args = func.get("arguments", {})
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except Exception:
                    args = {}
            else:
                args = raw_args

            if on_tool_start:
                on_tool_start(name, args)

            log.info("Tool trigger [%s]: %s(%s)", self._provider, name, args)
            output = self.tools.execute(name, args) if self.tools else "Tools unavailable"

            results.append({"name": name, "output": output})
            self._history.append({
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": str(output),
            })
        return results

    def _prepare_messages(self) -> list[dict[str, Any]]:
        cleaned = []
        for m in self._history:
            role = m.get("role")
            content = m.get("content")
            if role in ("system", "user", "assistant", "tool"):
                item: dict[str, Any] = {"role": role, "content": content or ""}
                if role == "tool" and "tool_call_id" in m:
                    item["tool_call_id"] = m["tool_call_id"]
                if role == "assistant" and "tool_calls" in m:
                    item["tool_calls"] = m["tool_calls"]
                cleaned.append(item)
        return cleaned

    def stream_reply(
        self,
        user_text: str,
        on_token: Optional[Callable[[str], None]] = None,
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> Generator[str, None, None]:
        if not self.model_ready():
            msg = self.unavailable_reply(user_text)
            if on_token:
                on_token(msg)
            yield msg
            return

        self._history.append({"role": "user", "content": user_text})
        self._trim()
        self.db.add_message(role="user", content=user_text)

        headers = self._get_headers()
        endpoint = f"{self._base_url}/chat/completions"
        tools_spec = self._get_tools_spec()

        try:
            # 1. Preflight tool execution check if tools enabled
            if tools_spec:
                payload = {
                    "model": self._model,
                    "messages": self._prepare_messages(),
                    "tools": tools_spec,
                    "stream": False,
                }
                with httpx.Client(timeout=30.0) as client:
                    resp = client.post(endpoint, headers=headers, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        choice = data.get("choices", [{}])[0]
                        msg = choice.get("message", {})
                        tool_calls = msg.get("tool_calls")
                        if tool_calls:
                            self._history.append({
                                "role": "assistant",
                                "content": msg.get("content") or "",
                                "tool_calls": tool_calls,
                            })
                            executed = self._handle_tool_calls(tool_calls, on_tool_start=on_tool_start)
                            self.db.add_message(role="assistant", content="[Executed Tools]", tool_calls=executed)
                        elif msg.get("content"):
                            # If no tools called, we already have complete text!
                            full_reply_text = msg["content"]
                            for char in full_reply_text:
                                if on_token:
                                    on_token(char)
                            yield full_reply_text
                            self._history.append({"role": "assistant", "content": full_reply_text})
                            self.db.add_message(role="assistant", content=full_reply_text)
                            return
                    else:
                        log.warning("Tool preflight returned status %s: %s", resp.status_code, resp.text[:200])

            # 2. Stream generation for final spoken response
            stream_payload = {
                "model": self._model,
                "messages": self._prepare_messages(),
                "stream": True,
            }

            full_reply: list[str] = []
            sentence_buffer: list[str] = []
            sentence_delimiters = {".", "!", "?", "\n"}

            with httpx.Client(timeout=45.0) as client:
                with client.stream("POST", endpoint, headers=headers, json=stream_payload) as response:
                    if response.status_code != 200:
                        error_detail = response.read().decode("utf-8", errors="replace")
                        raise LanguageModelError(
                            f"{self._provider.upper()} API error (HTTP {response.status_code}): {error_detail}"
                        )

                    for raw_line in response.iter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_part = line[5:].strip()
                        if data_part == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_part)
                            choice = chunk.get("choices", [{}])[0]
                            delta = choice.get("delta", {})
                            # Some reasoning models (e.g. gpt-oss-120b) put
                            # output in reasoning_content instead of content.
                            token = delta.get("content") or delta.get("reasoning_content", "")
                        except Exception:
                            continue

                        if not token:
                            continue

                        full_reply.append(token)
                        sentence_buffer.append(token)

                        if on_token:
                            on_token(token)

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
                f"Error calling {self._provider.upper()} ({self._model}): {exc}"
            ) from exc


class AnthropicChat(BaseChat):
    """Direct Anthropic Claude chat client using the Messages API."""

    def __init__(
        self,
        settings: Settings,
        db: Optional[Database] = None,
        tools: Optional[ToolRegistry] = None,
    ) -> None:
        super().__init__(settings, db=db, tools=tools)
        self._api_key = settings.llm_api_key or ""
        self._model = settings.llm_model or "claude-3-5-haiku-20241022"

    def model_ready(self) -> bool:
        return bool(self._api_key and self._api_key.strip())

    def unavailable_reply(self, user_text: str) -> str:
        return (
            f"I heard: {user_text}. An Anthropic API key is not configured yet. "
            "Please enter your Anthropic API key in Settings."
        )

    def _prepare_anthropic_messages(self) -> list[dict[str, Any]]:
        msgs = []
        for m in self._history:
            role = m.get("role")
            if role in ("user", "assistant"):
                msgs.append({"role": role, "content": m.get("content", "")})
        return msgs

    def stream_reply(
        self,
        user_text: str,
        on_token: Optional[Callable[[str], None]] = None,
        on_tool_start: Optional[Callable[[str, dict], None]] = None,
    ) -> Generator[str, None, None]:
        if not self.model_ready():
            msg = self.unavailable_reply(user_text)
            if on_token:
                on_token(msg)
            yield msg
            return

        self._history.append({"role": "user", "content": user_text})
        self._trim()
        self.db.add_message(role="user", content=user_text)

        headers = {
            "x-api-key": self._api_key.strip(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        endpoint = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": self._model,
            "max_tokens": 1024,
            "system": self._settings.system_prompt,
            "messages": self._prepare_anthropic_messages(),
            "stream": True,
        }

        full_reply: list[str] = []
        sentence_buffer: list[str] = []
        sentence_delimiters = {".", "!", "?", "\n"}

        try:
            with httpx.Client(timeout=45.0) as client:
                with client.stream("POST", endpoint, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        error_detail = response.read().decode("utf-8", errors="replace")
                        raise LanguageModelError(
                            f"Anthropic API error (HTTP {response.status_code}): {error_detail}"
                        )

                    for raw_line in response.iter_lines():
                        line = raw_line.strip()
                        if not line.startswith("data:"):
                            continue
                        data_part = line[5:].strip()
                        try:
                            evt = json.loads(data_part)
                        except Exception:
                            continue

                        evt_type = evt.get("type")
                        token = ""
                        if evt_type == "content_block_delta":
                            delta = evt.get("delta", {})
                            if delta.get("type") == "text_delta":
                                token = delta.get("text", "")

                        if not token:
                            continue

                        full_reply.append(token)
                        sentence_buffer.append(token)

                        if on_token:
                            on_token(token)

                        joined_buffer = "".join(sentence_buffer)
                        if any(delim in token for delim in sentence_delimiters) and len(joined_buffer.strip()) > 15:
                            yield joined_buffer.strip()
                            sentence_buffer.clear()

            remaining = "".join(sentence_buffer).strip()
            if remaining:
                yield remaining

            final_text = "".join(full_reply).strip()
            if not final_text:
                raise LanguageModelError("Claude returned an empty reply.")

            self._history.append({"role": "assistant", "content": final_text})
            self.db.add_message(role="assistant", content=final_text)

        except Exception as exc:
            if self._history and self._history[-1]["role"] == "user":
                self._history.pop()
            if isinstance(exc, LanguageModelError):
                raise
            raise LanguageModelError(f"Error calling Claude: {exc}") from exc


def create_chat_client(
    settings: Settings,
    db: Optional[Database] = None,
    tools: Optional[ToolRegistry] = None,
) -> BaseChat:
    """Factory creating the appropriate chat backend based on settings."""
    provider = settings.llm_provider.lower().strip()
    if provider == "ollama":
        return OllamaChat(settings, db=db, tools=tools)
    if provider == "anthropic":
        return AnthropicChat(settings, db=db, tools=tools)
    # Default to OpenAI-compatible client (handles groq, openai, gemini, openrouter, deepseek, custom)
    return OpenAICompatibleChat(settings, db=db, tools=tools)


def test_llm_connection(
    provider: str,
    model: str,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> dict[str, Any]:
    """Test connection to any LLM provider and measure latency."""
    provider = provider.lower().strip()
    meta = PROVIDER_REGISTRY.get(provider, PROVIDER_REGISTRY["custom"])
    if provider == "custom":
        url = (base_url or meta.get("default_base_url", "http://localhost:8000/v1")).rstrip("/")
    else:
        url = meta.get("default_base_url", "https://api.openai.com/v1").rstrip("/")
    start_time = time.time()

    try:
        if provider == "ollama":
            client = ollama.Client(host=url)
            resp = client.chat(
                model=model,
                messages=[{"role": "user", "content": "Say 'Hola online' in 2 words."}],
            )
            msg = resp.get("message", {}) if isinstance(resp, dict) else getattr(resp, "message", None)
            reply = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
        elif provider == "anthropic":
            if not api_key:
                return {"ok": False, "error": "Anthropic requires an API key (e.g. sk-ant-...)"}
            headers = {
                "x-api-key": api_key.strip(),
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            with httpx.Client(timeout=15.0) as http_client:
                r = http_client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json={
                        "model": model,
                        "max_tokens": 30,
                        "messages": [{"role": "user", "content": "Say 'Hola online' in 2 words."}],
                    },
                )
                if r.status_code != 200:
                    return {"ok": False, "error": f"Anthropic HTTP {r.status_code}: {r.text[:200]}"}
                data = r.json()
                reply = data.get("content", [{}])[0].get("text", "")
        else:
            # OpenAI compatible
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key.strip()}"
            if provider == "openrouter":
                headers["HTTP-Referer"] = "https://github.com/hassannh/Hola-voice-assistant"
                headers["X-Title"] = "Hola Voice Assistant"

            with httpx.Client(timeout=20.0) as http_client:
                r = http_client.post(
                    f"{url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Say 'Hola online' in 2 words."}],
                        "max_tokens": 256,
                    },
                )
                if r.status_code != 200:
                    return {"ok": False, "error": f"{provider.upper()} HTTP {r.status_code}: {r.text[:200]}"}
                data = r.json()
                msg_obj = data.get("choices", [{}])[0].get("message", {})
                # Reasoning models may return output in reasoning_content instead of content
                reply = msg_obj.get("content") or msg_obj.get("reasoning_content", "")

        elapsed_ms = round((time.time() - start_time) * 1000)
        return {
            "ok": True,
            "provider": provider,
            "model": model,
            "reply": reply.strip(),
            "latency_ms": elapsed_ms,
            "message": f"Connected to {meta.get('name', provider)} ({model}) in {elapsed_ms}ms!",
        }
    except Exception as exc:
        return {"ok": False, "provider": provider, "model": model, "error": str(exc)}
