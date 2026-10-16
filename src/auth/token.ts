import { z } from "zod";

/**
 * Signed session tokens: `<payload>.<signature>`, both base64url.
 * HMAC-SHA256 via Web Crypto, so the same code runs in the proxy and on the server.
 */

export const SESSION_COOKIE = "ffcc_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

const sessionSchema = z.object({
  userId: z.string().min(1),
  householdId: z.string().min(1),
  /** Expiry, seconds since epoch. */
  exp: z.number().int(),
});
export type Session = z.infer<typeof sessionSchema>;

const DEV_SECRET = "ffcc-dev-only-secret-do-not-use-in-production";

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) must be set in production");
  return DEV_SECRET;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(session: Omit<Session, "exp">, secret: string, now: number = Date.now()): Promise<string> {
  const payload: Session = { ...session, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_S };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | undefined, secret: string, now: number = Date.now()): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const sigBytes = fromBase64Url(sig);
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      sigBytes as Uint8Array<ArrayBuffer>,
      encoder.encode(body),
    );
    if (!ok) return null;
    const parsed = sessionSchema.safeParse(JSON.parse(new TextDecoder().decode(fromBase64Url(body))));
    if (!parsed.success || parsed.data.exp * 1000 < now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Dev login is for building and testing only. Real auth comes before any real data. */
export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.FFCC_DEV_LOGIN === "1";
}
