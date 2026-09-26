from __future__ import annotations

import tempfile
from pathlib import Path

from voice_assistant.db import Database
from voice_assistant.tools import ToolRegistry, _safe_eval, ast


def test_safe_math_eval():
    assert _safe_eval(ast.parse("2 + 2", mode="eval")) == 4
    assert _safe_eval(ast.parse("(10 * 5) - 8 / 2", mode="eval")) == 46.0
    assert _safe_eval(ast.parse("sqrt(144) + 10", mode="eval")) == 22.0
    assert _safe_eval(ast.parse("round(3.14159, 2)", mode="eval")) == 3.14


def test_safe_math_blocks_malicious():
    import pytest

    with pytest.raises(ValueError):
        _safe_eval(ast.parse("__import__('os').system('ls')", mode="eval"))

    with pytest.raises(ValueError):
        _safe_eval(ast.parse("open('/etc/passwd').read()", mode="eval"))


def test_tool_registry():
    with tempfile.TemporaryDirectory() as tmpdir:
        db = Database(Path(tmpdir) / "test.db")
        registry = ToolRegistry(db)

        # Check ollama schemas format
        schemas = registry.get_ollama_tools()
        names = [s["function"]["name"] for s in schemas]
        assert "get_current_time_and_date" in names
        assert "calculate" in names
        assert "get_system_status" in names
        assert "open_application" in names
        assert "play_music_spotify" in names
        assert "search_code_and_files" in names
        assert "read_code_file" in names
        assert "execute_terminal_command" in names
        assert "search_developer_web" in names
        assert "save_note" in names
        # Ensure get_weather is gone
        assert "get_weather" not in names

        # Execute calculate
        res = registry.execute("calculate", {"expression": "25 * 4"})
        assert "100" in res

        # Execute note saving and fetching
        res_save = registry.execute("save_note", {"note": "Fix audio buffer race condition"})
        assert "Fix audio buffer race condition" in res_save

        res_get = registry.execute("get_notes", {})
        assert "Fix audio buffer race condition" in res_get

        # Execute code search
        search_res = registry.execute("search_code_and_files", {"query": "ToolRegistry", "directory": "."})
        assert "ToolRegistry" in search_res

        # Execute terminal command
        term_res = registry.execute("execute_terminal_command", {"command": "echo 'Hello Hola'"})
        assert "Hello Hola" in term_res
