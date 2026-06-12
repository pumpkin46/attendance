from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings


def _build_engine():
    return create_async_engine(
        settings.database_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )


engine = _build_engine()
_session_factory = async_sessionmaker(engine, expire_on_commit=False)


def async_session_factory() -> AsyncSession:
    """Open a session on the current engine.

    A delegating function rather than the sessionmaker itself, so modules that
    imported it keep working after `reconfigure_engine()` swaps the underlying
    engine (e.g. when the setup wizard changes the database name at runtime).
    """
    return _session_factory()


async def reconfigure_engine() -> None:
    """Rebuild engine + session factory from current settings, disposing the old pool."""
    global engine, _session_factory
    old = engine
    engine = _build_engine()
    _session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        # May run on a different event loop than the old pool's connections
        # (setup worker thread); a failed close is harmless — the swap above
        # already routes all new sessions to the new engine.
        await old.dispose()
    except Exception:
        pass


async def dispose_engine() -> None:
    """Dispose whatever engine is current (app shutdown)."""
    await engine.dispose()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
