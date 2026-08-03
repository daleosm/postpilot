"""Low-cardinality Prometheus metrics for the PostPilot API.

Metrics intentionally describe operational behaviour only. Never add tenant,
user, show, episode, email, or raw URL values as labels: those can leak
customer data and make Prometheus unstable through unbounded cardinality.
"""

from __future__ import annotations

from time import perf_counter

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

HTTP_REQUESTS = Counter(
    "postpilot_http_requests_total",
    "Completed PostPilot API HTTP requests.",
    ("method", "route", "status_code"),
)
HTTP_REQUEST_DURATION = Histogram(
    "postpilot_http_request_duration_seconds",
    "PostPilot API request duration in seconds.",
    ("method", "route"),
)
HTTP_REQUESTS_IN_PROGRESS = Gauge(
    "postpilot_http_requests_in_progress",
    "PostPilot API requests currently being served.",
    ("method",),
)
DATABASE_READY = Gauge(
    "postpilot_database_ready",
    "Whether PostPilot could complete its latest readiness database check.",
)

_EXCLUDED_PATHS = frozenset({"/", "/healthz", "/live", "/ready", "/metrics"})


def metrics_response() -> Response:
    """Expose Prometheus text output without a trailing-slash redirect."""

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def instrument_http_request(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    """Record HTTP metrics without creating raw-path or customer-data labels."""

    if request.url.path in _EXCLUDED_PATHS:
        return await call_next(request)

    # Route metadata is populated only after FastAPI dispatches the request.
    # Use a bounded fallback rather than the raw path for unknown routes.
    route_label = "unmatched"
    method = request.method
    started = perf_counter()
    response: Response | None = None
    HTTP_REQUESTS_IN_PROGRESS.labels(method=method).inc()

    try:
        response = await call_next(request)
        return response
    finally:
        route = request.scope.get("route")
        route_label = getattr(route, "path", "unmatched") or "unmatched"
        status_code = str(response.status_code if response is not None else 500)
        elapsed = perf_counter() - started
        HTTP_REQUESTS.labels(method=method, route=route_label, status_code=status_code).inc()
        HTTP_REQUEST_DURATION.labels(method=method, route=route_label).observe(elapsed)
        HTTP_REQUESTS_IN_PROGRESS.labels(method=method).dec()
