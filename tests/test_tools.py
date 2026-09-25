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
        # Attempt code execution
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
        assert "save_note" in names

        # Execute calculate
        res = registry.execute("calculate", {"expression": "25 * 4"})
        assert "100" in res

        # Execute note saving and fetching
        res_save = registry.execute("save_note", {"note": "Call Alice at 5pm"})
        assert "Call Alice at 5pm" in res_save

        res_get = registry.execute("get_notes", {})
        assert "Call Alice at 5pm" in res_get
