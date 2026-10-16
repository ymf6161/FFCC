# Sample bank CSVs

Made-up bank exports for testing the CSV import. **All data is invented**: names, account numbers (`99-99-99 12345678`, `****9999`), transaction ids (`tx_fake…`) and amounts.

The layouts are modelled on how these UK banks describe their CSV exports. They have not been checked against real exports, so treat them as "styled after", not exact copies.

| File | Layout | Notes |
| --- | --- | --- |
| `barclays-style-current-2026-01-to-03.csv` | `Number,Date,Account,Amount,Subcategory,Memo`; dd/mm/yyyy; signed amounts | Newest first. Two identical £3.20 coffees on 10 Feb. |
| `barclays-style-current-2026-03-to-05.csv` | same | Overlaps March with the file above, including two identical coffees on 12 Mar. |
| `nationwide-style-joint-2026-01-to-03.csv` | 3 summary lines and a blank line, then `Date,Transaction type,Description,Paid out,Paid in,Balance`; `2 Jan 2026` dates; `£` amounts; running balance; CRLF | Two coffees on 14 Jan. |
| `nationwide-style-joint-2026-02-to-04.csv` | same | Overlaps February and March, including two coffees on 4 Mar. |
| `monzo-style-current-2026-02-to-03.csv` | `Transaction ID,Date,Time,Type,Name,Category,Amount,Currency,Notes,Description` | Transaction ids for dedupe. Two coffees on 24 Feb. |
| `monzo-style-current-2026-03-to-04.csv` | same | Overlaps March, including two coffees on 17 Mar. |
| `amex-style-card-2026-01-to-03.csv` | `Date,Description,Card Member,Account #,Amount`; spending shown as positive; byte-order mark | Two coffees on 8 Feb, a payment each month and a refund. |

Every file has some Hebrew descriptions.

The files also link up, so the engine can find transfers between them: the Barclays-style account pays the Amex-style card on the 22nd of January to March, and the Nationwide-style account tops up the Monzo-style account on the 1st of February to April. The Amex-style file has a purchase on 14 Feb and a partial refund of it on 2 Mar.

Import the files for each layout into their own account. Importing the second file of a pair adds only the rows the first did not have; importing any file twice adds nothing.

The files are generated from `tests/fixtures/csv-sources.ts` with `bun run fixtures`; a test checks they still match.
