import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySession } from "@/auth/token";

/** Sends anyone without a valid session to /login. */
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
