from datetime import UTC, datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.schemas import HealthResponse
from app.db.session import get_engine
from app.metrics import DATABASE_READY

router = APIRouter(tags=["operations"])


def _health() -> HealthResponse:
    return HealthResponse(status="ok", service="postpilot-api", timestamp=datetime.now(UTC))


# The public ALB's shared health-check path is `/`; retaining this endpoint
# keeps both the Next UI target group and the API target group healthy without
# a brittle ingress-level exception.
@router.get("/", response_model=HealthResponse, include_in_schema=False)
async def root_healthz() -> HealthResponse:
    return _health()


@router.get("/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    """Process-only liveness endpoint; never depend on external services."""

    return _health()


@router.get("/ready", response_model=HealthResponse)
async def ready(response: Response) -> HealthResponse:
    """Readiness endpoint used to withdraw an API pod when PostgreSQL is unavailable."""

    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        DATABASE_READY.set(0)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="unavailable", service="postpilot-api", timestamp=datetime.now(UTC))

    DATABASE_READY.set(1)
    return _health()


@router.get("/healthz", response_model=HealthResponse, deprecated=True)
async def healthz(response: Response) -> HealthResponse:
    """Compatibility alias retained while existing local tooling moves to `/ready`."""

    return await ready(response)
