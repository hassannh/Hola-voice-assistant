from __future__ import annotations

import asyncio
import json
import os
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from uvicorn import Config, Server

from voice_assistant.audio import audio_backend_error, list_input_devices
from voice_assistant.config import Settings
from voice_assistant.llm import PROVIDER_REGISTRY, test_llm_connection
from voice_assistant.ollama_status import probe_ollama, stream_pull
from voice_assistant.runtime import AssistantRuntime

STATIC_DIR = Path(__file__).resolve().parent / "static"


class SettingsUpdate(BaseModel):
    stt_model_size: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None
    record_seconds: Optional[float] = Field(default=None, ge=1, le=30)
    use_vad: Optional[bool] = None
    adaptive_vad: Optional[bool] = None
    max_record_seconds: Optional[float] = Field(default=None, ge=2, le=30)
    tts_rate: Optional[int] = Field(default=None, ge=80, le=300)
    input_device: Optional[int] = None
    system_prompt: Optional[str] = None
    enable_tools: Optional[bool] = None
    enable_tts: Optional[bool] = None
    wake_word: Optional[str] = None
    stream_tokens: Optional[bool] = None


class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ChatRequest(BaseModel):
    text: str = Field(..., min_length=1)
    speak: bool = False


class VoiceMuteRequest(BaseModel):
    enabled: Optional[bool] = None


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


def _get_providers_with_status(settings: Settings) -> dict[str, dict[str, Any]]:
    result = {}
    for pid, meta in PROVIDER_REGISTRY.items():
        p_dict = dict(meta)
        if pid == "ollama":
            p_dict["has_key"] = True
            p_dict["key_configured"] = True
            p_dict["masked_key"] = ""
        else:
            has_key = False
            masked_key = ""
            if settings.llm_provider == pid and settings.llm_api_key:
                has_key = True
                k = settings.llm_api_key.strip()
                masked_key = f"{k[:4]}••••{k[-4:]}" if len(k) > 8 else "••••••••"
            else:
                env_names = [f"{pid.upper()}_API_KEY", f"VOICE_{pid.upper()}_API_KEY"]
                if pid == "xai":
                    env_names.append("XAI_API_KEY")
                elif pid == "groq":
                    env_names.append("GROQ_API_KEY")
                for ev in env_names:
                    val = os.environ.get(ev)
                    if val and val.strip():
                        has_key = True
                        k = val.strip()
                        masked_key = f"{k[:4]}••••{k[-4:]}" if len(k) > 8 else "••••••••"
                        break
            p_dict["has_key"] = has_key
            p_dict["key_configured"] = has_key
            p_dict["masked_key"] = masked_key
        result[pid] = p_dict
    return result


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
            "providers": _get_providers_with_status(runtime.settings),
        }

    @app.get("/api/llm/providers")
    async def list_providers() -> dict:
        return {"ok": True, "providers": _get_providers_with_status(runtime.settings)}

    @app.post("/api/llm/test")
    async def test_llm(body: TestConnectionRequest) -> dict:
        api_key = body.api_key
        # If user did not send a new api_key (e.g. kept existing masked preview), use saved key
        if not api_key or "••••" in api_key or "***" in api_key:
            if runtime.settings.llm_provider == body.provider.lower():
                api_key = runtime.settings.llm_api_key

        base_url = body.base_url if body.provider.lower() == "custom" else None
        result = await asyncio.to_thread(
            test_llm_connection,
            provider=body.provider,
            model=body.model,
            api_key=api_key,
            base_url=base_url,
        )
        return result

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
            return {"ok": True, "reply": reply, "text": reply}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @app.post("/api/clear")
    async def clear_history() -> dict:
        await asyncio.to_thread(runtime.clear_history)
        return {"ok": True}

    @app.post("/api/voice/mute")
    async def toggle_voice_mute(body: VoiceMuteRequest = VoiceMuteRequest()) -> dict:
        enabled = body.enabled
        if enabled is None:
            enabled = not runtime.settings.enable_tts
        runtime.set_voice_output(bool(enabled))
        return {"ok": True, "enable_tts": runtime.settings.enable_tts}

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
        return {
            "ok": True,
            "settings": runtime.settings.public_dict(),
            "providers": _get_providers_with_status(runtime.settings),
        }

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

    # ── IDE: Terminal PTY WebSocket ────────────────────────────────
    @app.websocket("/ws/terminal")
    async def websocket_terminal(ws: WebSocket) -> None:
        await ws.accept()
        master_fd = None
        proc = None
        try:
            import fcntl
            import pty
            import struct
            import termios

            master_fd, slave_fd = pty.openpty()
            shell = os.environ.get("SHELL", "/bin/bash")
            proc = subprocess.Popen(
                [shell],
                preexec_fn=os.setsid,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=str(Path(".").resolve()),
            )
            os.close(slave_fd)

            flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
            fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            async def pty_to_ws():
                try:
                    while proc.poll() is None:
                        await asyncio.sleep(0.01)
                        try:
                            data = os.read(master_fd, 4096)
                            if data:
                                await ws.send_text(data.decode("utf-8", errors="replace"))
                        except (BlockingIOError, InterruptedError):
                            await asyncio.sleep(0.02)
                        except OSError:
                            break
                except Exception:
                    pass

            async def ws_to_pty():
                try:
                    while proc.poll() is None:
                        msg = await ws.receive_text()
                        if msg.startswith("{") and "resize" in msg:
                            try:
                                cmd = json.loads(msg)
                                if cmd.get("type") == "resize":
                                    cols = cmd.get("cols", 80)
                                    rows = cmd.get("rows", 24)
                                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                            except Exception:
                                pass
                        else:
                            os.write(master_fd, msg.encode("utf-8"))
                except Exception:
                    pass

            t1 = asyncio.create_task(pty_to_ws())
            t2 = asyncio.create_task(ws_to_pty())
            await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
            t1.cancel()
            t2.cancel()
        except Exception:
            pass
        finally:
            if master_fd is not None:
                try:
                    os.close(master_fd)
                except Exception:
                    pass
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass

    # ── IDE: File Explorer ─────────────────────────────────────────
    @app.get("/api/ide/tree")
    async def ide_file_tree(root: str = Query(default=".")) -> dict:
        """Return a nested file tree for the given root directory."""
        root_path = Path(root).expanduser().resolve()
        if not root_path.exists():
            raise HTTPException(status_code=404, detail="Path not found")

        def _build_tree(p: Path, depth: int = 0) -> dict:
            node: dict[str, Any] = {"name": p.name, "path": str(p), "type": "dir" if p.is_dir() else "file"}
            if p.is_dir() and depth < 5:
                try:
                    children = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
                    node["children"] = [
                        _build_tree(c, depth + 1)
                        for c in children
                        if not c.name.startswith(".") and c.name not in {"__pycache__", "node_modules", ".git", "venv", ".venv"}
                    ]
                except PermissionError:
                    node["children"] = []
            return node

        return {"ok": True, "tree": _build_tree(root_path)}

    @app.get("/api/ide/file")
    async def ide_read_file(path: str = Query(...)) -> dict:
        """Read a file's content."""
        fp = Path(path).expanduser().resolve()
        if not fp.exists() or not fp.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        if fp.stat().st_size > 2 * 1024 * 1024:  # 2 MB limit
            raise HTTPException(status_code=413, detail="File too large")
        try:
            content = fp.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return {"ok": True, "path": str(fp), "content": content, "language": _detect_language(fp)}

    class WriteFileRequest(BaseModel):
        path: str
        content: str

    @app.post("/api/ide/file")
    async def ide_write_file(body: WriteFileRequest) -> dict:
        """Write content to a file."""
        fp = Path(body.path).expanduser().resolve()
        try:
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(body.content, encoding="utf-8")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return {"ok": True, "path": str(fp)}

    # ── IDE: Code Search ───────────────────────────────────────────
    @app.get("/api/ide/search")
    async def ide_search(
        q: str = Query(...),
        root: str = Query(default="."),
        case_sensitive: bool = Query(default=False),
    ) -> dict:
        """Search for text across files using ripgrep (rg) or grep fallback."""
        root_path = str(Path(root).expanduser().resolve())
        flags = [] if case_sensitive else ["-i"]
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                ["rg", "--json", "--max-count=5", "--max-depth=8", *flags, q, root_path],
                capture_output=True, text=True, timeout=10,
            )
            matches = []
            for line in result.stdout.splitlines():
                try:
                    obj = json.loads(line)
                    if obj.get("type") == "match":
                        m = obj["data"]
                        matches.append({
                            "file": m["path"]["text"],
                            "line": m["line_number"],
                            "text": m["lines"]["text"].rstrip(),
                            "submatches": [{"start": s["start"], "end": s["end"]} for s in m.get("submatches", [])],
                        })
                except Exception:
                    pass
            return {"ok": True, "query": q, "matches": matches[:200]}
        except FileNotFoundError:
            # Fallback to grep
            result = await asyncio.to_thread(
                subprocess.run,
                ["grep", "-rn", *flags, q, root_path],
                capture_output=True, text=True, timeout=10,
            )
            matches = []
            for line in result.stdout.splitlines()[:200]:
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    matches.append({"file": parts[0], "line": int(parts[1]) if parts[1].isdigit() else 0, "text": parts[2]})
            return {"ok": True, "query": q, "matches": matches}

    # ── IDE: Git Source Control ────────────────────────────────────
    @app.get("/api/ide/git/status")
    async def ide_git_status(root: str = Query(default=".")) -> dict:
        root_path = str(Path(root).expanduser().resolve())
        r = await asyncio.to_thread(
            subprocess.run, ["git", "-C", root_path, "status", "--porcelain", "-b"],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode != 0:
            return {"ok": False, "error": r.stderr.strip()}
        lines = r.stdout.splitlines()
        branch = lines[0].lstrip("## ").split("...")[0] if lines else "unknown"
        files = []
        for line in lines[1:]:
            if len(line) >= 3:
                xy, name = line[:2], line[3:]
                files.append({"status": xy.strip(), "path": name})
        return {"ok": True, "branch": branch, "files": files}

    @app.get("/api/ide/git/diff")
    async def ide_git_diff(path: str = Query(default="."), root: str = Query(default=".")) -> dict:
        root_path = str(Path(root).expanduser().resolve())
        r = await asyncio.to_thread(
            subprocess.run, ["git", "-C", root_path, "diff", "HEAD", "--", path],
            capture_output=True, text=True, timeout=10,
        )
        return {"ok": True, "diff": r.stdout}

    @app.get("/api/ide/git/log")
    async def ide_git_log(root: str = Query(default="."), n: int = Query(default=20)) -> dict:
        root_path = str(Path(root).expanduser().resolve())
        r = await asyncio.to_thread(
            subprocess.run,
            ["git", "-C", root_path, "log", f"--max-count={n}",
             "--pretty=format:%H|%an|%ae|%ar|%s"],
            capture_output=True, text=True, timeout=10,
        )
        commits = []
        for line in r.stdout.splitlines():
            parts = line.split("|", 4)
            if len(parts) == 5:
                commits.append({"hash": parts[0][:8], "author": parts[1], "email": parts[2], "time": parts[3], "message": parts[4]})
        return {"ok": True, "commits": commits}

    class GitCommitRequest(BaseModel):
        message: str
        root: str = "."
        stage_all: bool = True

    @app.post("/api/ide/git/commit")
    async def ide_git_commit(body: GitCommitRequest) -> dict:
        root_path = str(Path(body.root).expanduser().resolve())
        if body.stage_all:
            await asyncio.to_thread(
                subprocess.run, ["git", "-C", root_path, "add", "-A"],
                capture_output=True, timeout=10,
            )
        r = await asyncio.to_thread(
            subprocess.run, ["git", "-C", root_path, "commit", "-m", body.message],
            capture_output=True, text=True, timeout=30,
        )
        return {"ok": r.returncode == 0, "output": r.stdout + r.stderr}

    return app


def _detect_language(fp: Path) -> str:
    """Map file extension to Monaco language identifier."""
    EXT_MAP = {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".jsx": "javascript", ".tsx": "typescript", ".html": "html",
        ".css": "css", ".json": "json", ".md": "markdown",
        ".sh": "shell", ".bash": "shell", ".yml": "yaml", ".yaml": "yaml",
        ".toml": "toml", ".rs": "rust", ".go": "go", ".cpp": "cpp",
        ".c": "c", ".h": "c", ".java": "java", ".kt": "kotlin",
        ".sql": "sql", ".xml": "xml", ".env": "shell", ".txt": "plaintext",
    }
    return EXT_MAP.get(fp.suffix.lower(), "plaintext")


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
