import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { isDebugMode } from "@/lib/runtime";

const authProxy = withAuth({
  pages: { signIn: "/sign-in" },
  secret: process.env.NEXTAUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "postpilot-local-development-secret" : undefined),
});

export default function proxy(request: NextRequest) {
  if (isDebugMode) return NextResponse.next();
  return authProxy(request as never, {} as never);
}

export const config = {
  matcher: ["/((?!api/auth|sign-in|_next/static|_next/image|favicon.ico).*)"],
};
