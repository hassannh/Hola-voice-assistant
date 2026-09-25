from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)


class Database:
    """Lightweight SQLite persistence for chat history, sessions, and tool logs."""

    def __init__(self, db_path: str | Path = "assistant_history.db") -> None:
        self.db_path = Path(db_path)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at REAL NOT NULL,
                    title TEXT DEFAULT 'New Session'
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    tool_calls TEXT DEFAULT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at REAL NOT NULL,
                    content TEXT NOT NULL
                );
                """
            )

    def get_or_create_active_session(self) -> int:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT id FROM sessions ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is not None:
                return int(row["id"])
            cursor = conn.execute(
                "INSERT INTO sessions (created_at, title) VALUES (?, ?)",
                (time.time(), "Default Session"),
            )
            return int(cursor.lastrowid)

    def add_message(
        self,
        role: str,
        content: str,
        session_id: Optional[int] = None,
        tool_calls: Optional[list[dict[str, Any]]] = None,
    ) -> int:
        sess_id = session_id or self.get_or_create_active_session()
        tool_calls_json = json.dumps(tool_calls) if tool_calls else None
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO messages (session_id, role, content, created_at, tool_calls)
                VALUES (?, ?, ?, ?, ?)
                """,
                (sess_id, role, content, time.time(), tool_calls_json),
            )
            return int(cursor.lastrowid)

    def get_recent_messages(
        self, session_id: Optional[int] = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        sess_id = session_id or self.get_or_create_active_session()
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT role, content, tool_calls, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (sess_id, limit),
            ).fetchall()

            result = []
            for row in rows:
                tool_calls = json.loads(row["tool_calls"]) if row["tool_calls"] else None
                result.append(
                    {
                        "role": row["role"],
                        "content": row["content"],
                        "tool_calls": tool_calls,
                        "created_at": row["created_at"],
                    }
                )
            return result

    def clear_session(self, session_id: Optional[int] = None) -> None:
        sess_id = session_id or self.get_or_create_active_session()
        with self._get_connection() as conn:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (sess_id,))

    def add_note(self, content: str) -> int:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "INSERT INTO notes (created_at, content) VALUES (?, ?)",
                (time.time(), content.strip()),
            )
            return int(cursor.lastrowid)

    def get_all_notes(self) -> list[dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT id, created_at, content FROM notes ORDER BY id DESC"
            ).fetchall()
            return [
                {"id": row["id"], "created_at": row["created_at"], "content": row["content"]}
                for row in rows
            ]
