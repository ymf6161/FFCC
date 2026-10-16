import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { accountDrift } from "@/import/drift";
import type { Mapping } from "@/import/mapping";
import { runImport } from "@/import/pipeline";
import { accountBalances } from "@/engine/totals";
import { createTestDb } from "../helpers";
import { engineHousehold, run } from "./helpers";

/** Rule 11: balances = opening (as at a date) + booked rows after it; differences from the bank are shown. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const MAPPING: Mapping = { headerRow: 0, dateColumn: "Date", dateFormat: "dd/mm/yyyy", amountColumn: "Amount", signConvention: "money_in_positive", descriptionColumns: ["Description"], runningBalanceColumn: "Balance" };

describe("rule 11: balances checked against the bank", () => {
  it("matches the bank's running balance after import and sorting (Hebrew rows)", async () => {
    const h = await engineHousehold(db, ["current"]);
    const csv = "Date,Description,Amount,Balance\n01/03/2026,משכורת SALARY,1000.00,1500.00\n02/03/2026,מכולת השכונה,-23.40,1476.60\n05/03/2026,תרומה לקופת צדקה,-50.00,1426.60\n";
    await runImport(db, { householdId: h.householdId, accountId: h.account(0), fileName: "a.csv", csvText: csv, mapping: MAPPING, profileName: "T", actor: h.actor });
    await run(db, h);
    expect(await accountDrift(db, h.householdId, h.account(0))).toEqual({ status: "matches", checkedOn: "2026-03-05" });
    const [b] = await accountBalances(db, h.householdId, "2026-03-05");
    expect(b!.balance).toBe(142_660);
  });

  it("shows the difference and since when if a row is missing", async () => {
    const h = await engineHousehold(db, ["current"]);
    const csv = "Date,Description,Amount,Balance\n01/03/2026,משכורת SALARY,1000.00,1500.00\n05/03/2026,תרומה לקופת צדקה,-50.00,1426.60\n";
    await runImport(db, { householdId: h.householdId, accountId: h.account(0), fileName: "a.csv", csvText: csv, mapping: MAPPING, profileName: "T", actor: h.actor });
    expect(await accountDrift(db, h.householdId, h.account(0))).toEqual({ status: "differs", difference: 2_340, since: "2026-03-05", checkedOn: "2026-03-05" });
  });
});
