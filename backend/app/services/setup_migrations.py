"""Background database creation + alembic migration runner for the setup wizard.

The wizard's "Database" step calls ``start_migration()``, which spawns a worker
thread that (1) creates the PostgreSQL database if missing, then (2) runs
``alembic upgrade head`` in-process. Progress (captured alembic log lines and
an applied/total counter) is kept in module state that the frontend polls.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]

_lock = threading.Lock()
_state: dict[str, Any] = {
    "status": "idle",  # idle | running | done | failed
    "lines": [],
    "total": 0,
    "completed": 0,
    "error": None,
}


def get_state() -> dict[str, Any]:
    with _lock:
        return {**_state, "lines": list(_state["lines"])}


def _append(line: str) -> None:
    with _lock:
        _state["lines"].append(line)
        # Keep the buffer bounded; the UI only needs the recent tail.
        if len(_state["lines"]) > 500:
            del _state["lines"][:100]


def _alembic_config():
    # Built programmatically (no alembic.ini) so alembic's fileConfig() never
    # runs inside the API process — it would reconfigure app/uvicorn logging.
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _pending_from(revision: str | None) -> int:
    """How many migration scripts lie between `revision` and head."""
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    return sum(1 for _ in script.iterate_revisions("heads", revision))


async def _fetch_current_revision() -> tuple[bool, str | None]:
    """(database reachable, current alembic revision or None when unmigrated)."""
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            try:
                result = await conn.execute(text("SELECT version_num FROM alembic_version"))
                return True, result.scalar()
            except Exception:
                # Connected, but the schema (or just the version table) is absent.
                return True, None
    except Exception:
        return False, None
    finally:
        await engine.dispose()


async def check_database() -> tuple[bool, int]:
    """(reachable, pending migration count; -1 when the DB is unreachable)."""
    reachable, revision = await _fetch_current_revision()
    if not reachable:
        return False, -1
    return True, _pending_from(revision)


async def _ensure_database() -> None:
    """Create the configured database if it doesn't exist (via the `postgres` db)."""
    admin_url = (
        f"postgresql+asyncpg://{settings.db_username}:{settings.db_password}"
        f"@{settings.db_host}:{settings.db_port}/postgres"
    )
    engine = create_async_engine(admin_url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            exists = (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": settings.db_database},
                )
            ).scalar()
            if exists:
                _append(f"Database '{settings.db_database}' already exists.")
            else:
                _append(f"Creating database '{settings.db_database}'…")
                await conn.execute(text(f'CREATE DATABASE "{settings.db_database}"'))
                _append(f"Database '{settings.db_database}' created.")
    finally:
        await engine.dispose()


class _AlembicLogHandler(logging.Handler):
    """Mirrors alembic's log output into the progress state."""

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        _append(msg)
        if msg.startswith("Running upgrade"):
            with _lock:
                _state["completed"] += 1


def _persist_env(key: str, value: str) -> None:
    """Write/update one KEY=value line in backend/.env so restarts keep it."""
    env_path = BACKEND_DIR / ".env"
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    replaced = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def start_migration(database_name: str | None = None) -> bool:
    """Kick off the worker thread; returns False if one is already running.

    ``database_name`` overrides the configured database: it is applied to the
    in-memory settings (all URLs are derived properties), persisted to .env,
    and the app's engine is rebuilt once migrations succeed.
    """
    with _lock:
        if _state["status"] == "running":
            return False
        _state.update({"status": "running", "lines": [], "total": 0, "completed": 0, "error": None})
    threading.Thread(target=_run, args=(database_name,), name="setup-migrations", daemon=True).start()
    return True


def _run(database_name: str | None = None) -> None:
    from alembic import command

    handler = _AlembicLogHandler(level=logging.INFO)
    alembic_logger = logging.getLogger("alembic")
    prev_level = alembic_logger.level
    alembic_logger.addHandler(handler)
    if alembic_logger.level == logging.NOTSET or alembic_logger.level > logging.INFO:
        alembic_logger.setLevel(logging.INFO)
    try:
        renamed = bool(database_name) and database_name != settings.db_database
        if renamed:
            assert database_name is not None
            _append(f"Database name set to '{database_name}'.")
            settings.db_database = database_name
            _persist_env("DB_DATABASE", database_name)

        _append(f"Connecting to PostgreSQL at {settings.db_host}:{settings.db_port}…")
        asyncio.run(_ensure_database())

        reachable, revision = asyncio.run(_fetch_current_revision())
        if not reachable:
            raise RuntimeError("Database is unreachable after creation")
        pending = _pending_from(revision)
        with _lock:
            _state["total"] = pending

        if pending == 0:
            _append("Schema is already up to date.")
        else:
            _append(f"Applying {pending} migration(s)…")
            command.upgrade(_alembic_config(), "head")
            _append("All migrations applied.")

        if renamed:
            # Point the live app at the new database without a restart.
            from app.core.database import reconfigure_engine

            asyncio.run(reconfigure_engine())
            _append("Application reconnected to the new database.")

        with _lock:
            _state["status"] = "done"
        _append("Database setup complete.")
    except Exception as exc:
        logger.exception("Setup migration failed")
        _append(f"ERROR: {exc}")
        with _lock:
            _state["status"] = "failed"
            _state["error"] = str(exc)
    finally:
        alembic_logger.removeHandler(handler)
        alembic_logger.setLevel(prev_level)
