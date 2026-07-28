import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveRequestId } from "@/lib/server-logging";

export default async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const passThrough = () => {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  };

  if (request.nextUrl.pathname.startsWith("/v1/")) {
    const apiOrigin = process.env.POSTPILOT_API_ORIGIN;
    if (apiOrigin) {
      return NextResponse.rewrite(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, apiOrigin));
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
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!sign-in|_next/static|_next/image|favicon.ico).*)"],
};
