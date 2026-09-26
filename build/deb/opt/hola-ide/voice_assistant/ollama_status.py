from __future__ import annotations

import json
import threading
from typing import Any, Callable, Generator, Optional
from urllib.error import URLError
from urllib.request import urlopen, Request

from voice_assistant.config import Settings


def probe_ollama(settings: Settings) -> dict[str, Any]:
    """Check LLM status (local Ollama daemon or cloud provider API)."""
    provider = settings.llm_provider.lower().strip()
    if provider != "ollama":
        has_key = bool(settings.llm_api_key and settings.llm_api_key.strip())
        p_names = {
            "groq": "Groq",
            "openai": "OpenAI",
            "anthropic": "Anthropic Claude",
            "gemini": "Google Gemini",
            "openrouter": "OpenRouter",
            "deepseek": "DeepSeek",
            "custom": "Custom LLM",
        }
        p_name = p_names.get(provider, provider.title())
        is_ready = has_key or (provider == "custom" and bool(settings.llm_base_url))

        if is_ready:
            msg = f"{p_name} is active ({settings.llm_model})."
        else:
            msg = f"{p_name} requires an API key in Settings."

        return {
            "provider": provider,
            "provider_name": p_name,
            "reachable": is_ready,
            "models": [settings.llm_model],
            "has_configured_model": is_ready,
            "pull_available": False,
            "has_api_key": has_key,
            "message": msg,
        }

    url = settings.ollama_host.rstrip("/") + "/api/tags"
    try:
        with urlopen(url, timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except URLError:
        return {
            "reachable": False,
            "models": [],
            "has_configured_model": False,
            "pull_available": False,
            "message": (
                "Ollama is not reachable. Start it with `ollama serve` — "
                "you can still test the microphone and voice."
            ),
        }
    except Exception as exc:
        return {
            "reachable": False,
            "models": [],
            "has_configured_model": False,
            "pull_available": False,
            "message": f"Could not query Ollama: {exc}",
        }

    names = [item.get("name", "") for item in payload.get("models", []) if item.get("name")]
    has_model = _model_installed(names, settings.llm_model)
    pull_available = not has_model

    if has_model:
        message = f"Ollama is ready ({settings.llm_model})."
    elif names:
        message = (
            f"Ollama is running but {settings.llm_model!r} is not installed. "
            "Click 'Download Model' in the dashboard to pull it."
        )
    else:
        message = (
            "Ollama is running but no models are downloaded yet. "
            "Click 'Download Model' to pull one."
        )
    return {
        "reachable": True,
        "models": names,
        "has_configured_model": has_model,
        "pull_available": pull_available,
        "message": message,
    }


def stream_pull(
    model: str,
    host: str,
    on_progress: Callable[[dict[str, Any]], None],
) -> None:
    """
    Stream-pull a model from Ollama and call *on_progress* for each progress
    event.  Runs synchronously — call from a background thread.

    Progress dict fields:
        status  : str   — e.g. "pulling manifest", "pulling layer …"
        total   : int   — total bytes for current layer (may be absent)
        completed: int  — bytes downloaded so far (may be absent)
        percent : float — 0.0–100.0 (computed here)
        done    : bool  — True on the final "success" event
        error   : str   — non-empty if pull failed
    """
    url = host.rstrip("/") + "/api/pull"
    body = json.dumps({"name": model, "stream": True}).encode()
    req = Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=600) as resp:
            for raw_line in resp:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                status    = event.get("status", "")
                total     = event.get("total", 0) or 0
                completed = event.get("completed", 0) or 0
                percent   = round(completed / total * 100, 1) if total else 0.0
                done      = status == "success"
                error     = event.get("error", "")

                on_progress({
                    "status":    status,
                    "total":     total,
                    "completed": completed,
                    "percent":   percent,
                    "done":      done,
                    "error":     error,
                })

                if done or error:
                    break
    except Exception as exc:
        on_progress({
            "status":    "error",
            "total":     0,
            "completed": 0,
            "percent":   0.0,
            "done":      False,
            "error":     str(exc),
        })


def _model_installed(names: list[str], wanted: str) -> bool:
    wanted = wanted.removesuffix(":latest")
    for name in names:
        base = name.removesuffix(":latest")
        if base == wanted or name == wanted:
            return True
    return False
