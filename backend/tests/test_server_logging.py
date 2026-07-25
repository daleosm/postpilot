import json
import logging
import re

from app.server_logging import log_server_error, resolve_request_id


def test_request_id_is_safe_or_replaced() -> None:
    assert resolve_request_id("request-123") == "request-123"
    assert re.fullmatch(r"[0-9a-f-]{36}", resolve_request_id("invalid value"))


def test_server_error_logging_redacts_credentials_and_query_strings(caplog) -> None:
    with caplog.at_level(logging.ERROR, logger="postpilot"):
        request_id = log_server_error(
            ValueError(
                "database postgres://postpilot:secret@db.example/postpilot?token=abc Authorization=Bearer token-value"
            ),
            {
                "event": "request_failed",
                "request_id": "request-456",
                "method": "POST",
                "path": "/v1/example?token=not-logged",
                "route_type": "route",
            },
        )
    assert request_id == "request-456"
    payload = json.loads(caplog.messages[-1])
    rendered = json.dumps(payload)
    assert (
        payload["event"] == "request_failed"
        and payload["requestId"] == "request-456"
        and payload["path"] == "/v1/example"
    )
    assert not any(secret in rendered for secret in ("secret", "token-value", "not-logged"))
