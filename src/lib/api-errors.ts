import { NextResponse } from "next/server";

import { logServerError, resolveRequestId } from "@/lib/server-logging";

/** Log an unexpected route-handler failure and return a correlation ID to support. */
export function unexpectedApiError(request: Request, event: string, error: unknown, message: string) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  logServerError(error, {
    event: "request_failed",
    operation: event,
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    routeType: "route",
  });
  return NextResponse.json({ error: message, requestId }, { status: 500, headers: { "x-request-id": requestId } });
}
