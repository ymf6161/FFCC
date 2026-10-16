import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, type Session, sessionSecret, verifySession } from "./token";

/** The signed-in session, or a redirect to /login. Pages scope every query by `householdId`. */
export async function requireSession(): Promise<Session> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) redirect("/login");
  return session;
}
