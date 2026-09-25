from __future__ import annotations

import ast
import datetime
import json
import logging
import math
import operator
import os
import platform
import shutil
import subprocess
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from voice_assistant.db import Database

log = logging.getLogger(__name__)


# Safe mathematical AST evaluator
_SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_SAFE_FUNCTIONS = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "abs": abs,
    "round": round,
    "log": math.log,
    "log10": math.log10,
    "ceil": math.ceil,
    "floor": math.floor,
}


def _safe_eval(node: ast.AST) -> float | int:
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPERATORS:
        return _SAFE_OPERATORS[type(node.op)](_safe_eval(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPERATORS:
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        return _SAFE_OPERATORS[type(node.op)](left, right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        func_name = node.func.id.lower()
        if func_name in _SAFE_FUNCTIONS:
            args = [_safe_eval(arg) for arg in node.args]
            return _SAFE_FUNCTIONS[func_name](*args)
    raise ValueError("Unsupported or unsafe math expression")


class Tool:
    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        func: Callable[..., Any],
    ) -> None:
        self.name = name
        self.description = description
        self.parameters = parameters
        self.func = func

    def to_ollama_format(self) -> dict[str, Any]:
        """Returns JSON schema format compatible with Ollama tools API."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def execute(self, **kwargs) -> str:
        try:
            res = self.func(**kwargs)
            if isinstance(res, (dict, list)):
                return json.dumps(res)
            return str(res)
        except Exception as exc:
            log.warning("Tool %s execution failed: %s", self.name, exc)
            return f"Error executing {self.name}: {exc}"


class ToolRegistry:
    """Central registry and executor for software engineering and laptop control capabilities."""

    def __init__(self, db: Optional[Database] = None) -> None:
        self.tools: Dict[str, Tool] = {}
        self.db = db or Database()
        self._register_default_tools()

    def register(self, tool: Tool) -> None:
        self.tools[tool.name] = tool

    def get_ollama_tools(self) -> List[dict[str, Any]]:
        return [tool.to_ollama_format() for tool in self.tools.values()]

    def execute(self, name: str, args: dict[str, Any]) -> str:
        tool = self.tools.get(name)
        if not tool:
            return f"Tool '{name}' not found."
        log.info("Executing tool: %s with args: %s", name, args)
        return tool.execute(**args)

    def _register_default_tools(self) -> None:
        # 1. Tool: get_current_time_and_date
        def _get_time() -> str:
            now = datetime.datetime.now()
            return now.strftime("Current time is %I:%M %p, %A, %B %d, %Y")

        self.register(
            Tool(
                name="get_current_time_and_date",
                description="Get the current local system date, day of the week, and time.",
                parameters={"type": "object", "properties": {}, "required": []},
                func=_get_time,
            )
        )

        # 2. Tool: get_system_status
        def _system_status() -> str:
            total, used, free = shutil.disk_usage("/")
            free_gb = round(free / (1024**3), 1)
            system = platform.system()
            release = platform.release()
            machine = platform.machine()
            return f"OS: {system} {release} ({machine}), Available Root Disk: {free_gb} GB."

        self.register(
            Tool(
                name="get_system_status",
                description="Get local laptop hardware and OS status (disk space, platform, architecture).",
                parameters={"type": "object", "properties": {}, "required": []},
                func=_system_status,
            )
        )

        # 3. Tool: calculate
        def _calc(expression: str) -> str:
            tree = ast.parse(expression, mode="eval")
            val = _safe_eval(tree)
            return f"Result: {val}"

        self.register(
            Tool(
                name="calculate",
                description="Safely evaluate a mathematical expression (e.g. '1024 * 768 / 16', 'sqrt(256)').",
                parameters={
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Math expression to evaluate.",
                        }
                    },
                    "required": ["expression"],
                },
                func=_calc,
            )
        )

        # 4. Tool: open_application
        def _open_app(app_name: str) -> str:
            name_lower = app_name.lower().strip()
            # Common desktop app aliases
            app_map = {
                "spotify": ["/snap/bin/spotify", "spotify"],
                "chrome": ["google-chrome", "chrome", "google-chrome-stable"],
                "browser": ["google-chrome", "firefox", "xdg-open"],
                "terminal": ["gnome-terminal", "x-terminal-emulator", "konsole", "cmd"],
                "vscode": ["code"],
                "code": ["code"],
                "files": ["nautilus", "dolphin", "thunar", "explorer"],
                "calculator": ["gnome-calculator", "kcalc", "calc"],
            }

            binary_candidates = app_map.get(name_lower, [name_lower])
            target_bin = None
            for cand in binary_candidates:
                if os.path.isabs(cand) and os.path.exists(cand):
                    target_bin = cand
                    break
                found = shutil.which(cand)
                if found:
                    target_bin = found
                    break

            if target_bin:
                try:
                    subprocess.Popen([target_bin], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return f"Successfully launched application '{app_name}' ({target_bin})."
                except Exception as e:
                    return f"Failed to launch '{app_name}': {e}"

            # Fallback to xdg-open on Linux or start on Windows
            try:
                if platform.system() == "Linux":
                    subprocess.Popen(["xdg-open", f"app://{app_name}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return f"Sent system request to open '{app_name}' via xdg-open."
                elif platform.system() == "Windows":
                    os.startfile(app_name)
                    return f"Opened application '{app_name}'."
            except Exception:
                pass

            return f"Application '{app_name}' was not found in system PATH."

        self.register(
            Tool(
                name="open_application",
                description="Launch or open an application on the laptop (e.g. 'spotify', 'chrome', 'terminal', 'code', 'files').",
                parameters={
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "Name of the app (e.g. 'spotify', 'chrome', 'terminal', 'vscode').",
                        }
                    },
                    "required": ["app_name"],
                },
                func=_open_app,
            )
        )

        # 5. Tool: play_music_spotify
        def _play_spotify(query: str = "") -> str:
            clean_q = query.strip()
            encoded = urllib.parse.quote(clean_q)

            # Check if desktop client exists
            spotify_bin = shutil.which("spotify") or ("/snap/bin/spotify" if os.path.exists("/snap/bin/spotify") else None)

            if clean_q:
                # Open search URI directly in desktop app if available, otherwise web player
                uri = f"spotify:search:{encoded}"
                try:
                    if platform.system() == "Linux" and shutil.which("xdg-open"):
                        subprocess.Popen(["xdg-open", uri], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    elif spotify_bin:
                        subprocess.Popen([spotify_bin, f"--uri={uri}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    else:
                        webbrowser.open(f"https://open.spotify.com/search/{encoded}")
                    return f"Searching and playing '{clean_q}' on Spotify."
                except Exception as e:
                    webbrowser.open(f"https://open.spotify.com/search/{encoded}")
                    return f"Opened Spotify search for '{clean_q}' in browser."
            else:
                if spotify_bin:
                    subprocess.Popen([spotify_bin], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return "Opened Spotify music player."
                webbrowser.open("https://open.spotify.com")
                return "Opened Spotify Web Player."

        self.register(
            Tool(
                name="play_music_spotify",
                description="Pick and play music, search songs, artists, or playlists on Spotify on this laptop.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Song title, artist name, or genre (e.g. 'Daft Punk', 'Lofi beats', 'Queen').",
                        }
                    },
                    "required": [],
                },
                func=_play_spotify,
            )
        )

        # 6. Tool: search_code_and_files
        def _search_code(query: str, directory: str = ".") -> str:
            target_dir = Path(directory).resolve()
            if not target_dir.exists():
                return f"Directory '{directory}' does not exist."

            matches = []
            q_lower = query.lower()
            try:
                for root, dirs, files in os.walk(target_dir):
                    # Skip hidden / heavy directories
                    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("venv", "node_modules", "__pycache__", "build", "dist")]
                    for f in files:
                        if f.startswith("."):
                            continue
                        f_path = Path(root) / f
                        rel_path = f_path.relative_to(target_dir)

                        # Match filename
                        if q_lower in f.lower():
                            matches.append(f"[File] {rel_path}")
                            if len(matches) >= 15:
                                break

                        # Search content in text/code files
                        if f.endswith((".py", ".js", ".ts", ".html", ".css", ".md", ".json", ".sh", ".txt", ".rs", ".go", ".c", ".cpp")):
                            try:
                                text = f_path.read_text(encoding="utf-8", errors="ignore")
                                for line_no, line in enumerate(text.splitlines(), start=1):
                                    if q_lower in line.lower():
                                        matches.append(f"{rel_path}:{line_no} -> {line.strip()[:80]}")
                                        if len(matches) >= 15:
                                            break
                            except Exception:
                                pass
                    if len(matches) >= 15:
                        break
            except Exception as e:
                return f"Search encountered error: {e}"

            if not matches:
                return f"No matches found for '{query}' in {directory}."
            return f"Search results for '{query}':\n" + "\n".join(matches)

        self.register(
            Tool(
                name="search_code_and_files",
                description="Search for code snippets, symbols, functions, or filenames across project directories on the laptop.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Code string, function name, keyword, or filename to find.",
                        },
                        "directory": {
                            "type": "string",
                            "description": "Target folder to search in (default is current project directory '.').",
                        },
                    },
                    "required": ["query"],
                },
                func=_search_code,
            )
        )

        # 7. Tool: read_code_file
        def _read_file(filepath: str, max_lines: int = 80) -> str:
            p = Path(filepath).resolve()
            if not p.is_file():
                return f"File '{filepath}' not found or is not a file."
            try:
                lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
                preview = lines[:max_lines]
                content = "\n".join(f"{i+1}: {line}" for i, line in enumerate(preview))
                extra = f"\n... [Truncated: showing first {max_lines} of {len(lines)} lines]" if len(lines) > max_lines else ""
                return f"File '{p.name}' ({len(lines)} lines total):\n{content}{extra}"
            except Exception as e:
                return f"Could not read file '{filepath}': {e}"

        self.register(
            Tool(
                name="read_code_file",
                description="Read and inspect the contents of a code file or configuration on the laptop.",
                parameters={
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "Path to the file to inspect (relative or absolute).",
                        },
                        "max_lines": {
                            "type": "integer",
                            "description": "Maximum lines to read (default 80).",
                        },
                    },
                    "required": ["filepath"],
                },
                func=_read_file,
            )
        )

        # 8. Tool: execute_terminal_command
        def _run_terminal(command: str) -> str:
            # Block destructive system commands for safety
            cmd_strip = command.strip()
            dangerous = ["rm -rf /", "mkfs", ":(){ :|:& };:", "dd if="]
            if any(d in cmd_strip for d in dangerous):
                return "Command blocked by security guardrails."

            try:
                res = subprocess.run(
                    cmd_strip,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                stdout = res.stdout.strip()
                stderr = res.stderr.strip()
                output = []
                if stdout:
                    output.append(stdout)
                if stderr:
                    output.append(f"[stderr]: {stderr}")
                out_str = "\n".join(output) if output else "(Command executed with no output)"
                return f"[Exit code {res.returncode}]\n{out_str[:1200]}"
            except subprocess.TimeoutExpired:
                return f"Command '{cmd_strip}' timed out after 15 seconds."
            except Exception as e:
                return f"Failed executing command '{cmd_strip}': {e}"

        self.register(
            Tool(
                name="execute_terminal_command",
                description="Execute a safe developer terminal / shell command (e.g. 'git status', 'git diff', 'pytest', 'ls -la', 'python test.py').",
                parameters={
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The shell command to execute.",
                        }
                    },
                    "required": ["command"],
                },
                func=_run_terminal,
            )
        )

        # 9. Tool: search_developer_web
        def _search_dev_web(query: str, engine: str = "google") -> str:
            encoded = urllib.parse.quote(query.strip())
            if engine == "stackoverflow":
                url = f"https://stackoverflow.com/search?q={encoded}"
            elif engine == "github":
                url = f"https://github.com/search?q={encoded}"
            else:
                url = f"https://duckduckgo.com/?q={encoded}"
            webbrowser.open(url)
            return f"Searched for '{query}' on {engine}: opened {url}"

        self.register(
            Tool(
                name="search_developer_web",
                description="Search the web for programming solutions, debugging errors, StackOverflow answers, or GitHub repositories.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Coding question, error message, or technology query.",
                        },
                        "engine": {
                            "type": "string",
                            "description": "Search target: 'google', 'stackoverflow', or 'github'.",
                        },
                    },
                    "required": ["query"],
                },
                func=_search_dev_web,
            )
        )

        # 10. Tool: save_note
        def _save_note(note: str) -> str:
            self.db.add_note(note)
            return f"Memorandum saved to scratchpad: '{note}'"

        self.register(
            Tool(
                name="save_note",
                description="Save a coding task, reminder, or snippet to the assistant's persistent scratchpad.",
                parameters={
                    "type": "object",
                    "properties": {
                        "note": {
                            "type": "string",
                            "description": "The note or task content to store.",
                        }
                    },
                    "required": ["note"],
                },
                func=_save_note,
            )
        )

        # 11. Tool: get_notes
        def _get_notes() -> str:
            notes = self.db.get_all_notes()
            if not notes:
                return "Scratchpad is empty."
            items = [f"- [{n['content']}]" for n in notes[:10]]
            return "Active scratchpad items:\n" + "\n".join(items)

        self.register(
            Tool(
                name="get_notes",
                description="Retrieve recently saved developer tasks or reminders from the assistant's scratchpad.",
                parameters={"type": "object", "properties": {}, "required": []},
                func=_get_notes,
            )
        )
