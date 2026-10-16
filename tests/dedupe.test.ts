import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { accounts, households, transactions } from "@/db/schema";
import { dedupeKey, normaliseDescription, withOccurrences } from "@/import/dedupe";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "./helpers";

describe("normaliseDescription", () => {
  it("leaves plain English descriptions as before", () => {
    expect(normaliseDescription("FRESHWAYS SUPERMARKET  #123")).toBe("freshways supermarket 123");
    expect(normaliseDescription("  Card payment - TESCO*STORES 4021 ")).toBe("card payment tesco stores 4021");
  });

  it("keeps Hebrew letters", () => {
    expect(normaliseDescription("תשלום לגמ״ח קהילתי")).toBe("תשלום לגמ ח קהילתי");
    expect(normaliseDescription("SO צדקה 2026")).toBe("so צדקה 2026");
  });

  it("matches Hebrew with and without vowel points", () => {
    expect(normaliseDescription("שָׁלוֹם")).toBe(normaliseDescription("שלום"));
    expect(normaliseDescription("שָׁלוֹם")).toBe("שלום");
  });

  it("keeps accented letters, in either Unicode form", () => {
    const composed = "Café Crème".normalize("NFC");
    const decomposed = "Café Crème".normalize("NFD");
    expect(normaliseDescription(composed)).toBe("café crème");
    expect(normaliseDescription(decomposed)).toBe("café crème");
  });

  it("never reduces a description with letters to nothing", () => {
    for (const text of ["תרומה", "Zoë", "Ñandú", "ΑΘΗΝΑ"]) {
      expect(normaliseDescription(text).length).toBeGreaterThan(0);
    }
  });
});

describe("dedupe keys for Hebrew descriptions", () => {
  const first = { date: "2026-05-04", amount: -18000, description: "קופת צדקה ירושלים" };
  const second = { date: "2026-05-04", amount: -18000, description: "גמ״ח כלי קודש" };

  it("gives two different same-day, same-amount payments different keys", () => {
    expect(dedupeKey(first)).not.toBe(dedupeKey(second));
    const rows = withOccurrences([first, second]);
    expect(rows.map((r) => r.dedupeOccurrence)).toEqual([1, 1]);
  });

  it("still numbers genuinely identical Hebrew rows 1 and 2", () => {
    const rows = withOccurrences([first, { ...first }]);
    expect(rows[0]!.dedupeKey).toBe(rows[1]!.dedupeKey);
    expect(rows.map((r) => r.dedupeOccurrence)).toEqual([1, 2]);
  });

  describe("in the database", () => {
    let db: Db;
    let cleanup: () => void;
    let householdId: string;
    let accountId: string;

    beforeAll(async () => {
      ({ db, cleanup } = await createTestDb());
      const now = nowIso();
      householdId = newId();
      accountId = newId();
      await db.insert(households).values({ id: householdId, name: "H", createdAt: now, updatedAt: now });
      await db.insert(accounts).values({
        id: accountId, householdId, type: "current", name: "Current", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now,
      });
    });
    afterAll(() => cleanup());

    const insert = (row: { date: string; amount: number; description: string; dedupeKey: string; dedupeOccurrence: number }) => {
      const now = nowIso();
      return db.insert(transactions).values({
        id: newId(), householdId, accountId, date: row.date, amount: row.amount, rawDescription: row.description,
        source: "csv", dedupeKey: row.dedupeKey, dedupeOccurrence: row.dedupeOccurrence, createdAt: now, updatedAt: now,
      });
    };

    it("stores both payments, and a later file holding only the second does not collide with the first", async () => {
      for (const row of withOccurrences([first, second])) await insert(row);

      // A later, overlapping import contains only the second payment. It gets occurrence 1
      // in that file; its key differs from the first payment's, so it is recognised as
      // the second payment again (a true duplicate), not mistaken for the first.
      const [again] = withOccurrences([second]);
      expect(again!.dedupeOccurrence).toBe(1);
      expect(again!.dedupeKey).not.toBe(dedupeKey(first));
      await expect(insert(again!)).rejects.toThrow(); // the unique index blocks the real duplicate

      const stored = await db.select().from(transactions);
      expect(stored.map((t) => t.rawDescription).sort()).toEqual([first.description, second.description].sort());
    });
  });
});
