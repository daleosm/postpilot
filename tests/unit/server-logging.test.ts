import assert from "node:assert/strict";
import test from "node:test";

import { logServerError, resolveRequestId } from "../../src/lib/server-logging";

test("uses a safe incoming request correlation ID and replaces unsafe values", () => {
  assert.equal(resolveRequestId("request-123"), "request-123");
  assert.match(resolveRequestId("invalid value"), /^[0-9a-f-]{36}$/);
});

test("server error logs redact credentials and exclude query strings", () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (message: string) => { messages.push(message); };

  try {
    const requestId = logServerError(
      new Error("database postgres://postpilot:secret@db.example/postpilot?token=abc Authorization=Bearer token-value"),
      { event: "request_failed", requestId: "request-456", method: "POST", path: "/api/example?token=not-logged", routeType: "route" },
    );
    assert.equal(requestId, "request-456");
  } finally {
    console.error = original;
  }

  const message = messages.join("\n");
  assert.match(message, /"event":"request_failed"/);
  assert.match(message, /"requestId":"request-456"/);
  assert.match(message, /"path":"\/api\/example"/);
  assert.doesNotMatch(message, /secret|token-value|not-logged/);
});
