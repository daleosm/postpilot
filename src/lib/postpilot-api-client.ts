/** Browser-side FastAPI client. It carries only the opaque HTTP-only cookie. */

const apiBasePath = process.env.NEXT_PUBLIC_POSTPILOT_API_PATH ?? "/v1";

export type ApiRequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

const wordBoundary = /(?<!^)([A-Z])/g;

function toSnakeCase(value: string) {
  return value.replace(wordBoundary, "_$1").toLowerCase();
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [toSnakeCase(key), snakeKeys(child)]));
  }
  return value;
}

function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelKeys);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [toCamelCase(key), camelKeys(child)]));
  }
  return value;
}

/**
 * Browser-form transport for the TypeScript UI.
 *
 * The public API is FastAPI `/v1` only. Forms naturally use camelCase while
 * Python uses snake_case, so this boundary converts JSON in both directions
 * without creating a second HTTP API or carrying backend logic in Next.js.
 */
export async function postpilotUiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/v1/")) throw new Error("PostPilot UI requests must use a native /v1 API path.");

  const headers = new Headers(options.headers);
  let body = options.body;
  if (typeof body === "string" && headers.get("content-type")?.includes("application/json")) {
    try {
      body = JSON.stringify(snakeKeys(JSON.parse(body)));
    } catch {
      // FastAPI returns the normal validation response for malformed JSON.
    }
  }
  const response = await fetch(path, { ...options, body, headers, credentials: "include" });
  if (!response.headers.get("content-type")?.includes("application/json")) return response;

  const raw = await response.text();
  if (!raw) return response;
  try {
    let payload = camelKeys(JSON.parse(raw)) as Record<string, unknown>;
    if (!response.ok && "detail" in payload) {
      const detail = payload.detail;
      if (typeof detail === "string") payload = { ...payload, error: detail };
      else if (Array.isArray(detail)) payload = { ...payload, error: "Check the submitted fields.", issues: detail };
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response(raw, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}

export async function postpilotApiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${apiBasePath}${path}`, {
    ...options,
    body,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new PostPilotApiError(
      response.status,
      typeof payload?.detail === "string" ? payload.detail : "The PostPilot API request failed.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class PostPilotApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PostPilotApiError";
  }
}
