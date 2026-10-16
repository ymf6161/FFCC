import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_S, signSession, verifySession } from "@/auth/token";

const SECRET = "a-test-secret-that-is-long-enough-123";

describe("session tokens", () => {
  it("round-trips a signed session", async () => {
    const token = await signSession({ userId: "u1", householdId: "h1" }, SECRET);
    expect(await verifySession(token, SECRET)).toMatchObject({ userId: "u1", householdId: "h1" });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession({ userId: "u1", householdId: "h1" }, SECRET);
    expect(await verifySession(token, `${SECRET}-other`)).toBeNull();
  });

  it("rejects a token whose household was changed", async () => {
    const token = await signSession({ userId: "u1", householdId: "h1" }, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "u1", householdId: "h2", exp: 9999999999 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects expired, empty and malformed tokens", async () => {
    const now = Date.now();
    const token = await signSession({ userId: "u1", householdId: "h1" }, SECRET, now);
    expect(await verifySession(token, SECRET, now + (SESSION_MAX_AGE_S + 1) * 1000)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("not-a-token", SECRET)).toBeNull();
    expect(await verifySession("a.b.c", SECRET)).toBeNull();
  });
});
