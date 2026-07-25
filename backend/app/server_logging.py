"""Minimal structured error logging safe for container stderr collection."""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

_REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def resolve_request_id(value: str | None = None) -> str:
    return value if value and _REQUEST_ID.fullmatch(value) else str(uuid.uuid4())


def _redact(value: str) -> str:
    value = re.sub(r"(postgres(?:ql)?://)[^\s'\"`]+", r"\1[REDACTED]", value, flags=re.I)
    value = re.sub(r"\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+", r"\1 [REDACTED]", value, flags=re.I)
    return re.sub(
        r"(nextauth_secret|authorization|cookie|password|token)=([^\s&]+)", r"\1=[REDACTED]", value, flags=re.I
    )


def log_server_error(error: Exception | object, context: dict[str, Any]) -> str:
    request_id = resolve_request_id(context.get("request_id"))
    payload = {
        "level": "error",
        "event": context["event"],
        "requestId": request_id,
        "error": {"name": type(error).__name__, "message": _redact(str(error))},
    }
    for key in ("operation", "method", "route_path", "route_type"):
        if context.get(key):
            payload[key] = context[key]
    if context.get("path"):
        payload["path"] = str(context["path"]).split("?", 1)[0]
    logging.getLogger("postpilot").error(json.dumps(payload, separators=(",", ":")))
    return request_id
