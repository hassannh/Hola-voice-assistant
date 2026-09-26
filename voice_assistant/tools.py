from __future__ import annotations

import ast
import datetime
import html
import json
import logging
import math
import operator
import os
import platform
import re
import shutil
import subprocess
import urllib.parse
import webbrowser
from html import unescape
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

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
        """Returns JSON schema format compatible with Ollama & OpenAI tools API."""
        params = json.loads(json.dumps(self.parameters))
        props = params.get("properties", {})
        reqs = set(params.get("required", []))
        for key, prop in props.items():
            if key not in reqs and "type" in prop:
                t = prop["type"]
                if isinstance(t, str) and t in ("string", "integer", "number", "boolean"):
                    prop["type"] = [t, "null"]

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": params,
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

        # 6. Tool: list_directory
        def _list_dir(directory: str | None = ".", path: str | None = None, max_depth: int | None = 2, **kwargs) -> str:
            directory = path or directory or "."
            max_depth = max_depth if max_depth is not None else 2
            target = Path(directory).resolve()
            if not target.exists():
                return f"Directory '{directory}' does not exist."
            if not target.is_dir():
                return f"Path '{directory}' is a file, not a directory."

            ignore_dirs = {".git", "venv", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".idea", ".vscode", "build", "dist", ".gemini", "brain"}
            lines: list[str] = [f"Directory listing for '{target.name or directory}' (max depth {max_depth}):"]

            def _walk(cur: Path, prefix: str, depth: int):
                if depth > max_depth:
                    return
                try:
                    entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
                except Exception as e:
                    lines.append(f"{prefix}[Permission denied: {e}]")
                    return

                visible = [e for e in entries if not e.name.startswith(".") and e.name not in ignore_dirs]
                for i, entry in enumerate(visible):
                    is_last = (i == len(visible) - 1)
                    connector = "└── " if is_last else "├── "
                    sub_prefix = prefix + ("    " if is_last else "│   ")
                    if entry.is_dir():
                        lines.append(f"{prefix}{connector}{entry.name}/")
                        _walk(entry, sub_prefix, depth + 1)
                    else:
                        size_kb = max(1, round(entry.stat().st_size / 1024, 1))
                        lines.append(f"{prefix}{connector}{entry.name} ({size_kb} KB)")

            _walk(target, "", 1)
            return "\n".join(lines[:100])

        self.register(
            Tool(
                name="list_directory",
                description="List contents of a directory in a clean tree hierarchy showing files, folders, and sizes.",
                parameters={
                    "type": "object",
                    "properties": {
                        "directory": {
                            "type": "string",
                            "description": "Path to directory to list (default is current folder '.').",
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum recursive folder depth to explore (default 2).",
                        },
                    },
                    "required": [],
                },
                func=_list_dir,
            )
        )

        # 7. Tool: search_code_and_files
        def _search_code(
            query: str = "",
            directory: str | None = ".",
            path: str | None = None,
            file_pattern: str | None = "",
            **kwargs,
        ) -> str:
            query = query or kwargs.get("text", "") or kwargs.get("keyword", "")
            directory = path or directory or "."
            file_pattern = file_pattern or ""
            target_dir = Path(directory).resolve()
            if not target_dir.exists():
                return f"Directory '{directory}' does not exist."

            matches = []
            q_lower = query.lower()
            ignore_dirs = {".git", "venv", ".venv", "node_modules", "__pycache__", ".pytest_cache", "build", "dist", ".gemini", "brain"}
            code_exts = {".py", ".js", ".ts", ".html", ".css", ".json", ".md", ".sh", ".yaml", ".yml", ".sql", ".rs", ".go", ".c", ".cpp", ".txt", ".env"}

            try:
                for root, dirs, files in os.walk(target_dir):
                    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ignore_dirs]
                    for f in files:
                        if f.startswith("."):
                            continue
                        if file_pattern and not f.endswith(file_pattern.lstrip("*")):
                            continue
                        f_path = Path(root) / f
                        rel_path = f_path.relative_to(target_dir)

                        if q_lower in f.lower():
                            matches.append(f"[Filename Match] {rel_path}")
                            if len(matches) >= 30:
                                break

                        if f_path.suffix.lower() in code_exts:
                            try:
                                text = f_path.read_text(encoding="utf-8", errors="ignore")
                                for line_no, line in enumerate(text.splitlines(), start=1):
                                    if q_lower in line.lower():
                                        matches.append(f"{rel_path}:{line_no} | {line.strip()[:100]}")
                                        if len(matches) >= 30:
                                            break
                            except Exception:
                                pass
                    if len(matches) >= 30:
                        break
            except Exception as e:
                return f"Search error: {e}"

            if not matches:
                return f"No matches found for '{query}' in {directory}."
            return f"Found {len(matches)} match(es) for '{query}':\n" + "\n".join(matches)

        self.register(
            Tool(
                name="search_code_and_files",
                description="Search for symbols, function definitions, text snippets, or filenames across the workspace codebase.",
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
                        "file_pattern": {
                            "type": "string",
                            "description": "Optional file extension or pattern filter (e.g. '.py', '.js').",
                        },
                    },
                    "required": ["query"],
                },
                func=_search_code,
            )
        )

        # 8. Tool: read_code_file
        def _read_file(
            filepath: str | None = None,
            file_path: str | None = None,
            path: str | None = None,
            start_line: int | None = 1,
            end_line: int | None = 120,
            **kwargs,
        ) -> str:
            actual_path = filepath or file_path or path or ""
            if not actual_path:
                return "Error: no filepath provided to read_code_file."
            p = Path(actual_path).resolve()
            if not p.is_file():
                return f"File '{actual_path}' not found or is not a file."
            try:
                all_lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
                total = len(all_lines)
                if total == 0:
                    return f"File '{p.name}' is empty (0 lines)."

                start_idx = max(1, start_line if start_line is not None else 1)
                end_idx = min(total, max(start_idx, end_line if end_line is not None else 120))
                slice_lines = all_lines[start_idx - 1 : end_idx]

                formatted = [f"{i}: {line}" for i, line in enumerate(slice_lines, start=start_idx)]
                content = "\n".join(formatted)
                note = ""
                if end_idx < total:
                    note = f"\n\n[Showing lines {start_idx} to {end_idx} of {total} total. Call read_code_file with start_line={end_idx + 1} to inspect further.]"
                return f"File '{p.name}' (lines {start_idx}-{end_idx} of {total}):\n{content}{note}"
            except Exception as e:
                return f"Could not read file '{filepath}': {e}"

        self.register(
            Tool(
                name="read_code_file",
                description="Read a file with 1-indexed line numbers. Specify start_line and end_line to inspect specific ranges.",
                parameters={
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "Path to the file to inspect (relative or absolute).",
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "1-indexed starting line number (default 1).",
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "1-indexed ending line number (default 120).",
                        },
                    },
                    "required": ["filepath"],
                },
                func=_read_file,
            )
        )

        # 9. Tool: execute_terminal_command
        def _run_terminal(command: str = "", cmd: str = "", timeout_seconds: int | None = 30, **kwargs) -> str:
            command = command or cmd or ""
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
                    timeout=max(5, min(timeout_seconds if timeout_seconds is not None else 30, 60)),
                    cwd=os.getcwd(),
                )
                stdout = res.stdout.strip()
                stderr = res.stderr.strip()
                output = []
                if stdout:
                    output.append(stdout)
                if stderr:
                    output.append(f"[stderr]:\n{stderr}")
                out_str = "\n".join(output) if output else "(Command finished with no output)"
                return f"[Exit code {res.returncode}]\n{out_str[:2500]}"
            except subprocess.TimeoutExpired:
                return f"Command '{cmd_strip}' timed out after {timeout_seconds} seconds."
            except Exception as e:
                return f"Failed executing command '{cmd_strip}': {e}"

        self.register(
            Tool(
                name="execute_terminal_command",
                description="Execute a safe developer terminal or bash command (e.g. 'pytest', 'git status', 'ls -la', 'python test.py').",
                parameters={
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The shell command to execute.",
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Command timeout in seconds (default 30, max 60).",
                        },
                    },
                    "required": ["command"],
                },
                func=_run_terminal,
            )
        )

        # 10. Tool: write_code_file
        def _write_file(
            filepath: str | None = None,
            file_path: str | None = None,
            path: str | None = None,
            content: str = "",
            **kwargs,
        ) -> str:
            actual_path = filepath or file_path or path or ""
            if not actual_path:
                return "Error: no filepath provided to write_code_file."
            p = Path(actual_path).resolve()
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
                line_count = len(content.splitlines())
                return f"Successfully wrote {line_count} line(s) ({len(content)} bytes) to '{actual_path}'."
            except Exception as e:
                return f"Failed writing file '{actual_path}': {e}"

        self.register(
            Tool(
                name="write_code_file",
                description="Create or overwrite a file with complete source code.",
                parameters={
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "Path to file to write.",
                        },
                        "content": {
                            "type": "string",
                            "description": "The full code/text content to write.",
                        },
                    },
                    "required": ["filepath", "content"],
                },
                func=_write_file,
            )
        )

        # 11. Tool: patch_code_file
        def _patch_file(
            filepath: str | None = None,
            file_path: str | None = None,
            path: str | None = None,
            target: str = "",
            replacement: str = "",
            **kwargs,
        ) -> str:
            actual_path = filepath or file_path or path or ""
            if not actual_path:
                return "Error: no filepath provided to patch_code_file."
            p = Path(actual_path).resolve()
            if not p.is_file():
                return f"File '{actual_path}' not found."
            try:
                text = p.read_text(encoding="utf-8")
                if target not in text:
                    return (
                        f"Error: target code snippet was not found in '{p.name}'. "
                        "Make sure whitespace, indentation, and line breaks match the file exactly. "
                        "You can call read_code_file to see the exact current lines."
                    )

                count = text.count(target)
                if count > 1:
                    log.warning("Multiple instances (%d) of target found in %s, replacing first instance.", count, p.name)

                new_text = text.replace(target, replacement, 1)
                p.write_text(new_text, encoding="utf-8")
                return f"Successfully patched '{p.name}'. Replaced {len(target.splitlines())} line(s) with {len(replacement.splitlines())} line(s)."
            except Exception as e:
                return f"Failed patching file '{actual_path}': {e}"

        self.register(
            Tool(
                name="patch_code_file",
                description="Replace an exact snippet of code in an existing file with new code.",
                parameters={
                    "type": "object",
                    "properties": {
                        "filepath": {
                            "type": "string",
                            "description": "Path to file to patch.",
                        },
                        "target": {
                            "type": "string",
                            "description": "Exact text snippet to replace.",
                        },
                        "replacement": {
                            "type": "string",
                            "description": "New replacement code.",
                        },
                    },
                    "required": ["filepath", "target", "replacement"],
                },
                func=_patch_file,
            )
        )

        # 12. Tool: search_developer_web
        def _search_dev_web(query: str, max_results: int = 5) -> str:
            clean_q = query.strip()
            try:
                url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(clean_q)
                resp = httpx.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0"},
                    timeout=10.0,
                    follow_redirects=True,
                )
                if resp.status_code == 200:
                    html_content = resp.text
                    raw_snippets = re.findall(r"<a[^>]*class=\"result__snippet\"[^>]*>(.*?)</a>", html_content, re.DOTALL)
                    raw_titles = re.findall(r"<a[^>]*class=\"result__title\"[^>]*>(.*?)</a>", html_content, re.DOTALL)
                    raw_urls = re.findall(r"<a[^>]*class=\"result__url\"[^>]*href=\"([^\"]+)\"", html_content, re.DOTALL)

                    items = []
                    for i in range(min(max_results, len(raw_snippets))):
                        title = re.sub(r"<[^>]+>", "", raw_titles[i]).strip() if i < len(raw_titles) else f"Result {i+1}"
                        snippet = re.sub(r"<[^>]+>", "", raw_snippets[i]).strip()
                        raw_link = raw_urls[i] if i < len(raw_urls) else ""
                        if "uddg=" in raw_link:
                            match = re.search(r"uddg=([^&]+)", raw_link)
                            clean_link = urllib.parse.unquote(match.group(1)) if match else raw_link
                        else:
                            clean_link = raw_link.strip()
                        items.append(f"{i+1}. **{unescape(title)}**\n   {unescape(snippet)}\n   URL: {clean_link}")

                    if items:
                        return f"Web search results for '{clean_q}':\n\n" + "\n\n".join(items)
            except Exception as exc:
                log.warning("DuckDuckGo search error: %s", exc)

            encoded = urllib.parse.quote(clean_q)
            fallback_url = f"https://duckduckgo.com/?q={encoded}"
            return f"Web search completed for '{clean_q}'. Results accessible at: {fallback_url}"

        self.register(
            Tool(
                name="search_developer_web",
                description="Live web search for programming documentation, solutions, StackOverflow answers, and library APIs.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Coding question, error message, documentation lookup, or library query.",
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of search results to return (default 5).",
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


def format_tool_action_label(name: str, args: dict | None = None) -> str:
    """Formats a human-friendly Antigravity-style badge for tool execution events."""
    args = args or {}
    if name == "read_code_file":
        fp = args.get("filepath", "")
        sl = args.get("start_line", 1)
        el = args.get("end_line")
        range_str = f" ({sl}-{el})" if el else ""
        return f"📖 Read `{fp}`{range_str}"
    elif name == "search_code_and_files":
        q = args.get("query", "")
        return f"🔍 Search codebase: `{q}`"
    elif name == "list_directory":
        d = args.get("directory", ".")
        return f"📁 List directory `{d}`"
    elif name == "patch_code_file":
        fp = args.get("filepath", "")
        return f"🛠️ Patch `{fp}`"
    elif name == "write_code_file":
        fp = args.get("filepath", "")
        return f"📝 Write `{fp}`"
    elif name == "execute_terminal_command":
        cmd = args.get("command", "")
        preview = f"{cmd[:36]}…" if len(cmd) > 36 else cmd
        return f"▶️ Run `{preview}`"
    elif name == "search_developer_web":
        q = args.get("query", "")
        return f"🌐 Search web: `{q}`"
    elif name == "get_system_status":
        return "💻 Inspect system status"
    elif name == "calculate":
        expr = args.get("expression", "")
        return f"🧮 Compute: `{expr}`"
    elif name == "open_application":
        app = args.get("app_name", "")
        return f"🚀 Launch app: `{app}`"
    elif name == "play_music_spotify":
        q = args.get("query", "")
        return f"🎵 Spotify: `{q}`" if q else "🎵 Open Spotify"
    elif name == "save_note":
        return "💾 Save scratchpad note"
    elif name == "get_notes":
        return "📋 Read scratchpad notes"
    return f"⚡ Tool: {name}"

