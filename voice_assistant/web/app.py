from __future__ import annotations

import asyncio
import json
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from uvicorn import Config, Server

from voice_assistant.audio import audio_backend_error, list_input_devices
from voice_assistant.config import Settings
from voice_assistant.ollama_status import probe_ollama, stream_pull
from voice_assistant.runtime import AssistantRuntime

STATIC_DIR = Path(__file__).resolve().parent / "static"


class SettingsUpdate(BaseModel):
    stt_model_size: Optional[str] = None
    llm_model: Optional[str] = None
    record_seconds: Optional[float] = Field(default=None, ge=1, le=30)
    use_vad: Optional[bool] = None
    adaptive_vad: Optional[bool] = None
    max_record_seconds: Optional[float] = Field(default=None, ge=2, le=30)
    tts_rate: Optional[int] = Field(default=None, ge=80, le=300)
    input_device: Optional[int] = None
    system_prompt: Optional[str] = None
    enable_tools: Optional[bool] = None
    wake_word: Optional[str] = None
    stream_tokens: Optional[bool] = None


class ChatRequest(BaseModel):
    text: str = Field(..., min_length=1)
    speak: bool = False


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def unregister(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    def publish_threadsafe(self, payload: dict[str, Any]) -> None:
        if self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(payload), self.loop)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        message = json.dumps(payload)
        for client in self.clients:
            try:
                await client.send_text(message)
            except Exception:
                dead.append(client)
        for client in dead:
            self.clients.discard(client)


def create_app(settings: Settings) -> FastAPI:
    hub = Hub()
    runtime = AssistantRuntime(settings)

    def on_event(kind: str, text: Optional[str]) -> None:
        hub.publish_threadsafe({"type": kind, "text": text})

    runtime.set_event_handler(on_event)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        yield

    app = FastAPI(title="Voice Assistant", version="0.3.0", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/state")
    async def state() -> dict:
        return {
            "running": runtime.is_running,
            "status": runtime.status,
            "last_error": runtime.last_error,
            "settings": runtime.settings.public_dict(),
            "history": runtime.history(),
            "devices": list_input_devices(),
            "tools": runtime.get_tools(),
            "notes": runtime.db.get_all_notes(),
            "audio_error": audio_backend_error(),
            "ollama": probe_ollama(runtime.settings),
        }

    @app.post("/api/start")
    async def start() -> dict:
        try:
            await asyncio.to_thread(runtime.start)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "status": runtime.status}

    @app.post("/api/stop")
    async def stop() -> dict:
        await asyncio.to_thread(runtime.stop)
        return {"ok": True, "status": runtime.status}

    @app.post("/api/chat")
    async def chat(body: ChatRequest) -> dict:
        try:
            reply = await asyncio.to_thread(runtime.chat_text, body.text, body.speak)
            return {"ok": True, "reply": reply}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @app.post("/api/clear")
    async def clear_history() -> dict:
        await asyncio.to_thread(runtime.clear_history)
        return {"ok": True}

    @app.post("/api/ollama/pull")
    async def pull_model() -> dict:
        """Trigger a background pull of the configured model.
        Progress events are broadcast over WebSocket as type='ollama_pull'.
        """
        model = runtime.settings.llm_model
        host  = runtime.settings.ollama_host

        def _run_pull() -> None:
            def _progress(event: dict) -> None:
                hub.publish_threadsafe({"type": "ollama_pull", **event})

            stream_pull(model=model, host=host, on_progress=_progress)

        t = threading.Thread(target=_run_pull, daemon=True, name="ollama-pull")
        t.start()
        return {"ok": True, "model": model, "message": f"Pulling {model!r} in background…"}

    @app.get("/api/tools")
    async def list_tools() -> dict:
        return {"ok": True, "tools": runtime.get_tools()}

    @app.get("/api/notes")
    async def list_notes() -> dict:
        return {"ok": True, "notes": runtime.db.get_all_notes()}

    @app.post("/api/settings")
    async def update_settings(body: SettingsUpdate) -> dict:
        changes = body.model_dump(exclude_unset=True)
        try:
            runtime.apply_settings(**changes)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "settings": runtime.settings.public_dict()}

    @app.websocket("/ws")
    async def websocket(ws: WebSocket) -> None:
        await hub.register(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            hub.unregister(ws)
        except Exception:
            hub.unregister(ws)

    return app


def serve(settings: Settings) -> None:
    app = create_app(settings)
    config = Config(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
    )
    print(f"Dashboard: http://{settings.host}:{settings.port}")
    Server(config).run()
