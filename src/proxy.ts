import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "@/auth/public-paths";
import { SESSION_COOKIE, sessionSecret, verifySession } from "@/auth/token";

/** Sends anyone without a valid session to /login. */
export async function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Framework assets only; every other path is checked in `proxy` above.
  matcher: ["/((?!_next/static/|_next/image/).*)"],
};
