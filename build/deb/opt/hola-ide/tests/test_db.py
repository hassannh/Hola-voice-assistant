from __future__ import annotations

import tempfile
from pathlib import Path

from voice_assistant.db import Database


def test_database_persistence():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_assistant.db"
        db = Database(db_path)

        # Sessions
        sess1 = db.get_or_create_active_session()
        assert sess1 > 0

        # Adding messages
        db.add_message(role="user", content="Hello assistant", session_id=sess1)
        db.add_message(
            role="assistant",
            content="Hello human!",
            session_id=sess1,
            tool_calls=[{"name": "test_tool"}],
        )

        history = db.get_recent_messages(session_id=sess1)
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "Hello assistant"
        assert history[1]["role"] == "assistant"
        assert history[1]["tool_calls"] == [{"name": "test_tool"}]

        # Notes
        db.add_note("Buy groceries")
        notes = db.get_all_notes()
        assert len(notes) == 1
        assert notes[0]["content"] == "Buy groceries"

        # Clear session
        db.clear_session(session_id=sess1)
        cleared_history = db.get_recent_messages(session_id=sess1)
        assert len(cleared_history) == 0
