import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { resolveAuthSecret } from "@/lib/auth-config";
import { DEBUG_SIGNED_OUT_VALUE, DEBUG_USER_COOKIE } from "@/lib/debug-users";
import { isDebugMode } from "@/lib/runtime";
import { resolveRequestId } from "@/lib/server-logging";

const authProxy = withAuth({
  pages: { signIn: "/sign-in" },
  secret: resolveAuthSecret(),
});

export default async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const passThrough = () => {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  };

  // Keep Auth.js callbacks and the development-only debug controls outside
  // the tenant/page guard. This explicit pass-through avoids a signed-out
  // debug cookie intercepting the credentials callback before it can issue a
  // real session.
  if (request.nextUrl.pathname.startsWith("/api/auth/") || request.nextUrl.pathname.startsWith("/api/debug/") || request.nextUrl.pathname === "/sign-in") {
    return passThrough();
  }
  const debugActor = request.cookies.get(DEBUG_USER_COOKIE)?.value;
  if (isDebugMode && debugActor !== DEBUG_SIGNED_OUT_VALUE) return passThrough();
  const response = await authProxy(request as never, {} as never);
  if (response) response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!api/auth|api/debug|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
