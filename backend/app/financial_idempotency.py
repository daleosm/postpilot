"""Database-backed replay protection for user-triggered financial writes.

The ledger has source-level unique constraints as its final defence.  This
middleware adds the API-level behaviour users expect when a browser retries a
POST after a slow connection: the original response is returned instead of
creating a second commercial operation.
"""

import hashlib
import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import and_, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth import get_actor
from app.db.session import get_session_factory
from app.db.tables import financial_idempotency_keys

_FINANCIAL_POST_PREFIXES = (
    "/v1/billing",
    "/v1/purchase-orders",
    "/v1/client-purchase-orders",
    "/v1/vendor-invoices",
    "/v1/work-orders",
    "/v1/catering",
    "/v1/budget",
    "/v1/bookings",
)
_NON_MUTATING_POST_PATHS = {"/v1/budget/estimate-preview", "/v1/bookings/conflicts"}
_TTL = timedelta(hours=24)


def _is_financial_post(request: Request) -> bool:
    path = request.url.path
    return (
        request.method == "POST"
        and path not in _NON_MUTATING_POST_PATHS
        and any(path == prefix or path.startswith(f"{prefix}/") for prefix in _FINANCIAL_POST_PREFIXES)
    )


async def _restore_request_body(request: Request) -> bytes:
    """Read and replay the body for downstream FastAPI validation."""
    body = await request.body()

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive  # type: ignore[attr-defined]
    return body


async def financial_idempotency_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Replay completed financial writes for a supplied ``Idempotency-Key``.

    Keys are optional for backwards compatibility with existing UI clients.
    New clients should supply one for every create/post/issue action. Pending
    keys return a conflict rather than running the commercial operation twice.
    """
    key = request.headers.get("Idempotency-Key")
    if not _is_financial_post(request) or not key:
        return await call_next(request)
    key = key.strip()
    if not key or len(key) > 255:
        return JSONResponse(status_code=400, content={"detail": "Idempotency-Key must be 1 to 255 characters."})

    body = await _restore_request_body(request)
    request_hash = hashlib.sha256(body).hexdigest()
    operation = f"POST {request.url.path}"
    now = datetime.now(UTC)

    async with get_session_factory()() as idempotency_session:
        try:
            actor = await get_actor(request, idempotency_session)
            organization_id = actor.organization_id
        except HTTPException:
            # The endpoint remains the authority for normal authentication
            # errors. Do not create a replay record for an anonymous request.
            return await call_next(request)

        lookup = and_(
            financial_idempotency_keys.c.organization_id == organization_id,
            financial_idempotency_keys.c.actor_user_id == actor.user_id,
            financial_idempotency_keys.c.operation == operation,
            financial_idempotency_keys.c.idempotency_key == key,
        )
        await idempotency_session.execute(
            delete(financial_idempotency_keys).where(and_(lookup, financial_idempotency_keys.c.expires_at < now))
        )
        inserted = await idempotency_session.execute(
            pg_insert(financial_idempotency_keys)
            .values(
                organization_id=organization_id,
                actor_user_id=actor.user_id,
                operation=operation,
                idempotency_key=key,
                request_hash=request_hash,
                expires_at=now + _TTL,
            )
            .on_conflict_do_nothing(constraint="financial_idempotency_actor_operation_key_unique")
            .returning(financial_idempotency_keys.c.id)
        )
        created_key_id = inserted.scalar_one_or_none()
        if not created_key_id:
            existing = (await idempotency_session.execute(select(financial_idempotency_keys).where(lookup))).first()
            await idempotency_session.rollback()
            if not existing:
                # A concurrent request may have removed an expired record;
                # asking the browser to retry is safer than double-posting.
                return JSONResponse(
                    status_code=409,
                    content={"detail": "This financial request is being prepared. Retry shortly."},
                )
            if existing.request_hash != request_hash:
                return JSONResponse(
                    status_code=409,
                    content={"detail": "This Idempotency-Key was already used with a different request."},
                )
            if existing.response_status is None:
                return JSONResponse(
                    status_code=409,
                    content={"detail": "This financial request is already in progress. Retry shortly."},
                    headers={"Idempotency-Replayed": "pending"},
                )
            return JSONResponse(
                status_code=int(existing.response_status),
                content=existing.response_body,
                headers={"Idempotency-Replayed": "true"},
            )
        await idempotency_session.commit()

    response = await call_next(request)
    response_body = b"".join([chunk async for chunk in response.body_iterator])
    headers = {name: value for name, value in response.headers.items() if name.lower() != "content-length"}
    replayable = response.status_code < 500
    try:
        decoded_body: object = json.loads(response_body.decode("utf-8")) if response_body else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        decoded_body = {"detail": "Financial response was not JSON and cannot be replayed."}
        replayable = False

    async with get_session_factory()() as idempotency_session:
        lookup = and_(financial_idempotency_keys.c.id == created_key_id)
        if replayable:
            await idempotency_session.execute(
                update(financial_idempotency_keys)
                .where(lookup)
                .values(
                    response_status=response.status_code,
                    response_body=decoded_body,
                    completed_at=datetime.now(UTC),
                )
            )
        else:
            # Do not strand a key after an unexpected server failure. The
            # source/allocation constraints still protect the eventual retry.
            await idempotency_session.execute(delete(financial_idempotency_keys).where(lookup))
        await idempotency_session.commit()

    return Response(
        content=response_body,
        status_code=response.status_code,
        headers=headers,
        media_type=response.media_type,
        background=response.background,
    )
