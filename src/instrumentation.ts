import type { Instrumentation } from "next";

import { logServerError, resolveRequestId } from "@/lib/server-logging";

/** Captures unhandled render, server-action, proxy, and route errors globally. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const requestIdHeader = request.headers["x-request-id"];
  const requestId = resolveRequestId(Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader);
  logServerError(error, {
    event: "request_failed",
    requestId,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
