"""Bridge for running the app's async services inside sync Celery tasks."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

T = TypeVar("T")


def run_async(impl: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run an async unit of work in a fresh event loop with its own DB engine.

    Celery workers are synchronous and may run many tasks per process. Creating a
    dedicated engine per invocation (and disposing it after) avoids asyncpg
    connection pools binding to an event loop that no longer exists on the next
    task run.
    """

    async def _runner() -> T:
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with session_factory() as session:
                return await impl(session)
        finally:
            await engine.dispose()

    return asyncio.run(_runner())
