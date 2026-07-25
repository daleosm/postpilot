"""PostgreSQL concurrency contract for the FastAPI credential throttle."""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW, _record_failed_login
from app.db.tables import auth_login_attempts

pytestmark = pytest.mark.skipif(
    os.getenv("POSTPILOT_RUN_DB_TESTS") != "true",
    reason="Login throttle concurrency test runs in CI against PostgreSQL.",
)


def _sqlalchemy_url() -> str:
    value = (
        os.getenv("POSTPILOT_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or "postgresql://postpilot:postpilot@localhost:5432/postpilot"
    )
    if value.startswith("postgres://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgres://")
    if value.startswith("postgresql://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgresql://")
    return value


async def _exercise_parallel_failures(email: str) -> tuple[int, datetime | None, int, datetime | None]:
    engine = create_async_engine(_sqlalchemy_url(), pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime(2035, 1, 1, 10, tzinfo=UTC)

    async def record() -> None:
        async with factory() as session:
            await _record_failed_login(session, email, now)

    try:
        await asyncio.gather(*(record() for _ in range(LOGIN_FAILURE_LIMIT)))
        async with factory() as session:
            attempt = (
                await session.execute(
                    select(auth_login_attempts.c.failed_attempts, auth_login_attempts.c.locked_until).where(
                        auth_login_attempts.c.email == email
                    )
                )
            ).one()
        async with factory() as session:
            await _record_failed_login(session, email, now + LOGIN_FAILURE_WINDOW)
        async with factory() as session:
            reset = (
                await session.execute(
                    select(auth_login_attempts.c.failed_attempts, auth_login_attempts.c.locked_until).where(
                        auth_login_attempts.c.email == email
                    )
                )
            ).one()
        return attempt.failed_attempts, attempt.locked_until, reset.failed_attempts, reset.locked_until
    finally:
        async with factory() as session:
            await session.execute(delete(auth_login_attempts).where(auth_login_attempts.c.email == email))
            await session.commit()
        await engine.dispose()


def test_parallel_failed_credentials_attempts_do_not_lose_increments_or_bypass_lockout() -> None:
    email = f"python-login-throttle-{uuid4().hex}@postpilot.test"
    attempts, locked_until, reset_attempts, reset_locked_until = asyncio.run(_exercise_parallel_failures(email))

    assert attempts == LOGIN_FAILURE_LIMIT
    assert locked_until and locked_until > datetime(2035, 1, 1, 10, tzinfo=UTC)
    assert reset_attempts == 1
    assert reset_locked_until is None
