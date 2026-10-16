import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { getMembership } from "@/db/queries";
import { SESSION_COOKIE, type Session, sessionSecret, verifySession } from "./token";

/**
 * The signed-in session, or a redirect to /login. Pages scope every query by
 * `householdId`. A validly signed cookie is not enough: the user must still
 * be a member of the household (it may have been rebuilt by `bun run setup`).
 * Cached per request, so the layout and page share one check.
 */
export const requireSession = cache(async (): Promise<Session> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) redirect("/login");
  const membership = await getMembership(await getDb(), session.householdId, session.userId);
  if (!membership) redirect("/login?expired=1");
  return session;
});
