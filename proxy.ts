import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "./lib/auth/sessionToken";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawSession = request.cookies.get("lia-auth")?.value ?? "";
  const sessionUser = rawSession ? await verifySessionToken(rawSession) : null;
  const hasValidSession = Boolean(sessionUser);

  if (pathname === "/login") {
    if (hasValidSession) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
    return NextResponse.next();
  }

  if (!hasValidSession) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("lia-auth", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Skip API, Next internals and any request that targets a static file (contains a dot).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
