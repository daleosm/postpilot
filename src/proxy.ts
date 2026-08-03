import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveRequestId } from "@/lib/server-logging";
import { buildContentSecurityPolicy, securityResponseHeaders } from "@/lib/security-headers";

export default async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  // Next consumes `x-nonce` while rendering and adds it to its own scripts.
  // The same policy is returned to the browser below.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const secure = (response: NextResponse) => {
    response.headers.set("x-request-id", requestId);
    response.headers.set("Content-Security-Policy", csp);
    for (const header of securityResponseHeaders) response.headers.set(header.key, header.value);
    return response;
  };
  const passThrough = () => {
    return secure(NextResponse.next({ request: { headers: requestHeaders } }));
  };

  if (request.nextUrl.pathname.startsWith("/v1/")) {
    const apiOrigin = process.env.POSTPILOT_API_ORIGIN;
    if (apiOrigin) {
      return secure(
        NextResponse.rewrite(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, apiOrigin), {
          request: { headers: requestHeaders },
        }),
      );
    }
    return passThrough();
  }
  if (request.nextUrl.pathname === "/sign-in") {
    return passThrough();
  }
  // FastAPI owns the opaque session. The API also validates it for every
  // operation; this edge guard only avoids rendering protected UI while the
  // user is signed out.
  if (request.cookies.has("postpilot_session")) return passThrough();
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = secure(NextResponse.redirect(signIn));
  // Redirects intentionally have no body. Stating the type prevents clients
  // and passive scanners from attempting to infer one.
  response.headers.set("Content-Type", "text/plain; charset=utf-8");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
