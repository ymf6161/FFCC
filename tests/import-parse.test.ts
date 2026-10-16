import { describe, expect, it } from "vitest";
import { parseCsv } from "@/import/csv";
import { detectLayout, findHeaderRow, guessMapping } from "@/import/detect";
import { bankProfileMappingSchema, type Mapping } from "@/import/mapping";
import { endOfDayBalances, normaliseRows } from "@/import/normalise";
import { guessDateFormats, parseAmount, parseDate } from "@/import/parse-values";

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes, commas and new lines inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""","line\nbreak"\n1,2,3,4')).toEqual([
      ["a", "b, c", 'say "hi"', "line\nbreak"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("handles a byte-order mark, CRLF and blank lines", () => {
    expect(parseCsv("﻿Date,Amount\r\n\r\n01/02/2026,-3.20\r\n")).toEqual([
      ["Date", "Amount"],
      ["01/02/2026", "-3.20"],
    ]);
  });

  it("keeps empty fields and a missing final new line", () => {
    expect(parseCsv(",x,\n1,,3")).toEqual([
      ["", "x", ""],
      ["1", "", "3"],
    ]);
  });

  it("keeps Hebrew text intact", () => {
    expect(parseCsv('תאריך,תיאור\n01/02/2026,"גמ״ח, כלי קודש"')).toEqual([
      ["תאריך", "תיאור"],
      ["01/02/2026", "גמ״ח, כלי קודש"],
    ]);
  });
});

describe("parseDate", () => {
  it.each([
    ["16/10/2026", "dd/mm/yyyy", "2026-10-16"],
    ["1/2/2026", "dd/mm/yyyy", "2026-02-01"],
    ["16/10/26", "dd/mm/yy", "2026-10-16"],
    ["2026-10-16", "yyyy-mm-dd", "2026-10-16"],
    ["2026-10-16T10:22:00Z", "yyyy-mm-dd", "2026-10-16"],
    ["16-10-2026", "dd-mm-yyyy", "2026-10-16"],
    ["2 Jan 2026", "d mmm yyyy", "2026-01-02"],
    ["02-Jan-2026", "d mmm yyyy", "2026-01-02"],
    ["2 January 2026", "d mmm yyyy", "2026-01-02"],
    ["2 Jan 26", "d mmm yy", "2026-01-02"],
    ["29/02/2028", "dd/mm/yyyy", "2028-02-29"],
  ] as const)("reads %s as %s", (raw, format, expected) => {
    expect(parseDate(raw, format)).toBe(expected);
  });

  it.each([
    ["31/02/2026", "dd/mm/yyyy"],
    ["29/02/2026", "dd/mm/yyyy"],
    ["13/13/2026", "dd/mm/yyyy"],
    ["2026-10-16", "dd/mm/yyyy"],
    ["16/10/2026", "dd/mm/yy"],
    ["2 Foo 2026", "d mmm yyyy"],
    ["", "dd/mm/yyyy"],
  ] as const)("rejects %j as %s", (raw, format) => {
    expect(parseDate(raw, format)).toBeNull();
  });

  it("guesses formats that read every sample", () => {
    expect(guessDateFormats(["16/10/2026", "01/02/2026"])).toEqual(["dd/mm/yyyy"]);
    expect(guessDateFormats(["2 Jan 2026"])).toEqual(["d mmm yyyy"]);
    expect(guessDateFormats(["nonsense"])).toEqual([]);
  });
});

describe("parseAmount", () => {
  it.each([
    ["12.34", 1234],
    ["-12.34", -1234],
    ["+3.20", 320],
    ["£1,234.56", 123456],
    ["-£5", -500],
    ["£-5", -500],
    ["(12.34)", -1234],
    ["0.07", 7],
    ["40.5", 4050],
    [" 1 234.00 ", 123400],
    ["0.00", 0],
    ["-0.00", 0],
  ])("reads %j as %i pence", (raw, pence) => {
    expect(parseAmount(raw)).toBe(pence);
  });

  it("returns null for an empty cell and undefined for text that isn't an amount", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    for (const bad of ["abc", "12.345", "1,23", "--5", "-£-5", "£", "1e3", "12.3.4"]) expect(parseAmount(bad), bad).toBeUndefined();
  });

  it("never returns -0", () => {
    expect(Object.is(parseAmount("-0.00"), -0)).toBe(false);
  });
});

const base: Mapping = {
  headerRow: 0,
  dateColumn: "Date",
  dateFormat: "dd/mm/yyyy",
  amountColumn: "Amount",
  signConvention: "money_in_positive",
  descriptionColumns: ["Description"],
};

describe("findHeaderRow and guessMapping", () => {
  it("skips an account summary above the table", () => {
    const rows = parseCsv('"Account Name:","Joint ****9999"\n"Balance:","£10.00"\n\nDate,Description,Paid out,Paid in,Balance\n2 Jan 2026,SHOP,£1.00,,£9.00\n3 Jan 2026,PAY,,£5.00,£14.00');
    expect(findHeaderRow(rows)).toBe(2);
    expect(guessMapping(rows, 2)).toMatchObject({
      dateColumn: "Date",
      dateFormat: "d mmm yyyy",
      debitColumn: "Paid out",
      creditColumn: "Paid in",
      runningBalanceColumn: "Balance",
      descriptionColumns: ["Description"],
    });
  });

  it("guesses money-out-positive when an amount column has no negative values", () => {
    const rows = parseCsv("Date,Description,Amount\n01/01/2026,SHOP,12.00\n02/01/2026,SHOP,3.00");
    expect(guessMapping(rows, 0).signConvention).toBe("money_out_positive");
  });

  it("prefers a saved household profile over a preset", () => {
    const rows = parseCsv("Date,Description,Amount\n01/01/2026,SHOP,12.00");
    const saved = [{ name: "Our card", headerSignature: "date|description|amount", mapping: { ...base, signConvention: "money_in_positive" as const } }];
    const detection = detectLayout(rows, saved);
    expect(detection.recognisedAs).toBe("Our card");
    expect(detection.mapping.signConvention).toBe("money_in_positive");
    // A plain three-column file is not mistaken for a preset; the mapping is guessed from the data.
    expect(detectLayout(rows, []).recognisedAs).toBeNull();
    expect(detectLayout(rows, []).mapping.signConvention).toBe("money_out_positive");
    const card = parseCsv("Date,Description,Card Member,Account #,Amount\n01/01/2026,SHOP,MR A TEST,-99999,12.00");
    expect(detectLayout(card, []).recognisedAs).toBe("Amex-style card CSV");
  });
});

describe("normaliseRows", () => {
  it("reads a signed amount column", () => {
    const rows = parseCsv("Date,Description,Amount\n01/02/2026,SALARY,2950.00\n02/02/2026,SHOP,-12.34");
    const result = normaliseRows(rows, base);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.date, r.amount, r.description])).toEqual([
      ["2026-02-01", 295000, "SALARY"],
      ["2026-02-02", -1234, "SHOP"],
    ]);
  });

  it("flips a card statement where spending is positive", () => {
    const rows = parseCsv("Date,Description,Amount\n01/02/2026,SHOP,12.34\n02/02/2026,PAYMENT,-500.00");
    const result = normaliseRows(rows, { ...base, signConvention: "money_out_positive" });
    expect(result.rows.map((r) => r.amount)).toEqual([-1234, 50000]);
  });

  it("reads paid-out and paid-in columns and a balance", () => {
    const rows = parseCsv("Date,Description,Out,In,Balance\n01/02/2026,SHOP,£12.34,,£87.66\n02/02/2026,PAY,,£100.00,£187.66\n03/02/2026,FEE,-1.00,0.00,£186.66");
    const mapping: Mapping = { ...base, amountColumn: undefined, debitColumn: "Out", creditColumn: "In", runningBalanceColumn: "Balance" };
    const result = normaliseRows(rows, mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.amount, r.balance])).toEqual([
      [-1234, 8766],
      [10000, 18766],
      [-100, 18666],
    ]);
  });

  it("puts a newest-first file into date order", () => {
    const rows = parseCsv("Date,Description,Amount\n03/02/2026,C,-3.00\n02/02/2026,B,-2.00\n02/02/2026,A,-1.00\n01/02/2026,Z,-9.00");
    const result = normaliseRows(rows, base);
    expect(result.fileOrder).toBe("newest_first");
    expect(result.rows.map((r) => r.description)).toEqual(["Z", "A", "B", "C"]);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([4, 3, 2, 1]);
  });

  it("reports rows it can't read with their row number and reason, and keeps the rest", () => {
    const rows = parseCsv("Date,Description,Amount\n31/02/2026,BAD DATE,-1.00\n01/02/2026,BAD AMOUNT,abc\n01/02/2026,,-1.00\n02/02/2026,GOOD,-2.00\n03/02/2026,NO AMOUNT,");
    const result = normaliseRows(rows, base);
    expect(result.rows.map((r) => r.description)).toEqual(["GOOD"]);
    expect(result.errors).toEqual([
      { rowNumber: 1, reason: "The date “31/02/2026” doesn’t match 16/10/2026." },
      { rowNumber: 2, reason: "“abc” isn’t an amount." },
      { rowNumber: 3, reason: "There is no description." },
      { rowNumber: 5, reason: "There is no amount." },
    ]);
  });

  it("explains a missing column instead of failing silently", () => {
    const rows = parseCsv("When,What,How much\n01/02/2026,X,-1.00");
    const result = normaliseRows(rows, base);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.reason).toMatch(/no column called “Date”/);
  });

  it("joins several description columns", () => {
    const rows = parseCsv("Date,Name,Description,Amount\n01/02/2026,Coffee Corner,COFFEE CORNER LONDON,-3.20");
    const result = normaliseRows(rows, { ...base, descriptionColumns: ["Name", "Description"] });
    expect(result.rows[0]?.description).toBe("Coffee Corner COFFEE CORNER LONDON");
  });

  it("takes the end-of-day balance from the last row of each day", () => {
    const rows = parseCsv("Date,Description,Amount,Balance\n01/02/2026,A,-1.00,99.00\n01/02/2026,B,-2.00,97.00\n02/02/2026,C,-3.00,94.00");
    const result = normaliseRows(rows, { ...base, runningBalanceColumn: "Balance" });
    expect(endOfDayBalances(result.rows)).toEqual([
      { date: "2026-02-01", balance: 9700 },
      { date: "2026-02-02", balance: 9400 },
    ]);
  });
});

describe("bankProfileMappingSchema", () => {
  it("needs an amount column or both paid-out and paid-in columns", () => {
    expect(bankProfileMappingSchema.safeParse(base).success).toBe(true);
    expect(bankProfileMappingSchema.safeParse({ ...base, amountColumn: undefined, debitColumn: "Out" }).success).toBe(false);
    expect(bankProfileMappingSchema.safeParse({ ...base, dateFormat: "mm/dd/yyyy" }).success).toBe(false);
  });
});
