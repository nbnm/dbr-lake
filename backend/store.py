"""SQLite is a local prototype store, not the planned production Lakebase store."""
import json
import sqlite3
from threading import RLock
from pathlib import Path
from .models import SceneEvent


class EventStore:
    def __init__(self, path: str):
        self.lock = RLock()
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, event_time INTEGER NOT NULL, envelope TEXT NOT NULL)")
        self.db.execute("CREATE INDEX IF NOT EXISTS event_time_idx ON events(event_time)")
        self.db.commit()

    def append_many(self, events: list[SceneEvent]) -> None:
        with self.lock, self.db:
            for event in events:
                self.db.execute("INSERT OR IGNORE INTO events(event_id,event_time,envelope) VALUES(?,?,?)",
                                (event.event_id, event.event_time, event.model_dump_json()))

    def read(self, until: int, after: int = 0, limit: int | None = None) -> list[SceneEvent]:
        # sqlite3 connections are shared by FastAPI's worker threads. SQLite on
        # the host may use multithread mode, which requires external serialization.
        with self.lock:
            rows = self.db.execute("SELECT sequence,envelope FROM events WHERE sequence > ? AND event_time <= ? ORDER BY sequence LIMIT ?", (after, until, limit if limit is not None else -1)).fetchall()
        return [SceneEvent.model_validate({**json.loads(data), "sequence": seq}) for seq, data in rows]

    def valid_cursor(self, cursor: int) -> bool:
        with self.lock:
            return cursor == 0 or self.db.execute("SELECT 1 FROM events WHERE sequence = ?", (cursor,)).fetchone() is not None

    def close(self) -> None:
        with self.lock:
            self.db.close()
