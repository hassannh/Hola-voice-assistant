from __future__ import annotations

import json
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from voice_assistant.config import Settings


def probe_ollama(settings: Settings) -> dict[str, Any]:
    """Check the local Ollama daemon without pulling anything."""
    url = settings.ollama_host.rstrip("/") + "/api/tags"
    try:
        with urlopen(url, timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except URLError:
        return {
            "reachable": False,
            "models": [],
            "has_configured_model": False,
            "message": (
                "Ollama is not reachable. Start it with `ollama serve` later — "
                "you can still test the microphone and voice."
            ),
        }
    except Exception as exc:
        return {
            "reachable": False,
            "models": [],
            "has_configured_model": False,
            "message": f"Could not query Ollama: {exc}",
        }

    names = [item.get("name", "") for item in payload.get("models", []) if item.get("name")]
    has_model = _model_installed(names, settings.llm_model)
    if has_model:
        message = f"Ollama is ready ({settings.llm_model})."
    elif names:
        message = (
            f"Ollama is running, but {settings.llm_model} is not installed yet. "
            "Mic and speech still work. Pull the model when your connection is better."
        )
    else:
        message = (
            "Ollama is running, but no model is downloaded yet. "
            "Leave the pull for later. Mic and speech still work."
        )
    return {
        "reachable": True,
        "models": names,
        "has_configured_model": has_model,
        "message": message,
    }


def _model_installed(names: list[str], wanted: str) -> bool:
    wanted = wanted.removesuffix(":latest")
    for name in names:
        base = name.removesuffix(":latest")
        if base == wanted or name == wanted:
            return True
    return False
