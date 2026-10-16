"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { findDemoMembership } from "@/seed";
import { devLoginEnabled, SESSION_COOKIE, SESSION_MAX_AGE_S, sessionSecret, signSession } from "./token";

export type LoginState = { error: string | null };

export async function devLogin(_prev: LoginState, _form: FormData): Promise<LoginState> {
  if (!devLoginEnabled()) return { error: "Demo sign-in is switched off on this server." };
  const membership = await findDemoMembership(await getDb());
  if (!membership) {
    return { error: "There is no demo household yet. Run bun run setup, then try again." };
  }
  const token = await signSession(membership, sessionSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  redirect("/");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
