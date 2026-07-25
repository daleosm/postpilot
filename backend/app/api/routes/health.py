from datetime import UTC, datetime

from fastapi import APIRouter

from app.api.schemas import HealthResponse

router = APIRouter(tags=["operations"])


def _health() -> HealthResponse:
    return HealthResponse(status="ok", service="postpilot-api", timestamp=datetime.now(UTC))


# The public ALB's shared health-check path is `/`; retaining this endpoint
# keeps both the Next UI target group and the API target group healthy without
# a brittle ingress-level exception.
@router.get("/", response_model=HealthResponse, include_in_schema=False)
async def root_healthz() -> HealthResponse:
    return _health()


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return _health()
