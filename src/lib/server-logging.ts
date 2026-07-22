export type ServerLogContext = {
  event: string;
  operation?: string;
  requestId?: string;
  method?: string;
  path?: string;
  routePath?: string;
  routeType?: string;
};

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function redact(value: string) {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "$1[REDACTED]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(nextauth_secret|authorization|cookie|password|token)=([^\s&]+)/gi, "$1=[REDACTED]");
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
    return {
      name: error.name,
      message: redact(error.message),
      ...(digest ? { digest: redact(digest) } : {}),
      ...(error.stack ? { stack: redact(error.stack) } : {}),
    };
  }

  return { name: "NonError", message: redact(String(error)) };
}

/** Returns an incoming correlation ID only when it is safe to echo and log. */
export function resolveRequestId(value?: string | null) {
  return value && requestIdPattern.test(value) ? value : crypto.randomUUID();
}

/**
 * Write one JSON line to stderr. Kubernetes captures stderr and the CloudWatch
 * observability add-on forwards it without requiring application credentials.
 * Request bodies, cookies, headers and tenant/user identifiers are never logged.
 */
export function logServerError(error: unknown, context: ServerLogContext) {
  const requestId = resolveRequestId(context.requestId);
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: context.event,
    ...(context.operation ? { operation: context.operation } : {}),
    requestId,
    ...(context.method ? { method: context.method } : {}),
    ...(context.path ? { path: context.path.split("?")[0] } : {}),
    ...(context.routePath ? { routePath: context.routePath } : {}),
    ...(context.routeType ? { routeType: context.routeType } : {}),
    error: errorDetails(error),
  }));
  return requestId;
}
