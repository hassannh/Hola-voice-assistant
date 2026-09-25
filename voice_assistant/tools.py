from __future__ import annotations

import ast
import datetime
import json
import logging
import math
import operator
import platform
import shutil
import urllib.parse
import urllib.request
import webbrowser
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
    """Central registry and executor for assistant capabilities."""

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
        # Tool: get_current_time_and_date
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

        # Tool: get_system_status
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
                description="Get local computer hardware and OS status (disk space, platform, architecture).",
                parameters={"type": "object", "properties": {}, "required": []},
                func=_system_status,
            )
        )

        # Tool: calculate
        def _calc(expression: str) -> str:
            tree = ast.parse(expression, mode="eval")
            val = _safe_eval(tree)
            return f"Result: {val}"

        self.register(
            Tool(
                name="calculate",
                description="Safely evaluate a mathematical expression (e.g. '12 * 8.5', 'sqrt(144)').",
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

        # Tool: open_browser_url
        def _open_url(url: str) -> str:
            if not url.startswith(("http://", "https://")):
                url = "https://" + url
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                return "Invalid URL provided."
            webbrowser.open(url)
            return f"Opened {url} in your default web browser."

        self.register(
            Tool(
                name="open_browser_url",
                description="Open a web page or search in the default web browser.",
                parameters={
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "URL to open (e.g. 'https://github.com' or 'https://google.com').",
                        }
                    },
                    "required": ["url"],
                },
                func=_open_url,
            )
        )

        # Tool: save_note
        def _save_note(note: str) -> str:
            self.db.add_note(note)
            return f"Note saved successfully: '{note}'"

        self.register(
            Tool(
                name="save_note",
                description="Save a text note, reminder, or snippet to the assistant's persistent scratchpad.",
                parameters={
                    "type": "object",
                    "properties": {
                        "note": {
                            "type": "string",
                            "description": "The note content to store.",
                        }
                    },
                    "required": ["note"],
                },
                func=_save_note,
            )
        )

        # Tool: get_notes
        def _get_notes() -> str:
            notes = self.db.get_all_notes()
            if not notes:
                return "No notes stored yet."
            items = [f"- [{n['content']}]" for n in notes[:10]]
            return "Stored notes:\n" + "\n".join(items)

        self.register(
            Tool(
                name="get_notes",
                description="Retrieve recently saved notes or reminders from the assistant's scratchpad.",
                parameters={"type": "object", "properties": {}, "required": []},
                func=_get_notes,
            )
        )

        # Tool: get_weather
        def _get_weather(city: str) -> str:
            safe_city = urllib.parse.quote(city.strip())
            url = f"https://wttr.in/{safe_city}?format=%C+%t+(humidity:+%h,+wind:+%w)&m"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "curl/7.68.0"})
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    weather_text = resp.read().decode("utf-8").strip()
                    return f"Weather in {city}: {weather_text}"
            except Exception as e:
                return f"Could not fetch weather for '{city}' ({e})."

        self.register(
            Tool(
                name="get_weather",
                description="Get the current weather conditions for a given city.",
                parameters={
                    "type": "object",
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "Name of the city (e.g. 'London', 'New York').",
                        }
                    },
                    "required": ["city"],
                },
                func=_get_weather,
            )
        )
