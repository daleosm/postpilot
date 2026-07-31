from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(settings.sqlalchemy_database_url, pool_pre_ping=True, pool_size=10, max_overflow=10)


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        try:
            yield session
        finally:
            # Financial routes commit complete ledger units explicitly. Any
            # uncommitted unit left by a validation error or unexpected
            # exception is rolled back when its request scope ends, rather
            # than leaking a partial transaction to the connection pool.
            if session.in_transaction():
                await session.rollback()
