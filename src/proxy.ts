import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { resolveAuthSecret } from "@/lib/auth-config";
import { DEBUG_SIGNED_OUT_VALUE, DEBUG_USER_COOKIE } from "@/lib/debug-users";
import { isDebugMode } from "@/lib/runtime";

const authProxy = withAuth({
  pages: { signIn: "/sign-in" },
  secret: resolveAuthSecret(),
});

export default function proxy(request: NextRequest) {
  // Keep Auth.js callbacks and the development-only debug controls outside
  // the tenant/page guard. This explicit pass-through avoids a signed-out
  // debug cookie intercepting the credentials callback before it can issue a
  // real session.
  if (request.nextUrl.pathname.startsWith("/api/auth/") || request.nextUrl.pathname.startsWith("/api/debug/") || request.nextUrl.pathname === "/sign-in") {
    return NextResponse.next();
  }
  const debugActor = request.cookies.get(DEBUG_USER_COOKIE)?.value;
  if (isDebugMode && debugActor !== DEBUG_SIGNED_OUT_VALUE) return NextResponse.next();
  return authProxy(request as never, {} as never);
}

export const config = {
  matcher: ["/((?!api/auth|api/debug|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
