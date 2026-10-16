# FFCC — Build Plan

Family Financial Control Centre. Version 2 of the build plan, 16 Oct 2026 (after /plan-eng-review; decisions and reasons in Appendix A).

This file is the project's memory. Claude Code sessions start with no memory of earlier sessions, so every decision that matters lives here. When a decision changes, update this file in the same commit as the code.

Read alongside:
- `docs/ffcc-summary.md` (technical summary)
- `docs/ffcc-product-direction.md` (UX, features and core workflows)
- `docs/DESIGN.md` (design system, produced by /design-consultation)
- `CLAUDE.md` (house rules for every session)

---

## 1. What we are building

A personal and family finance system that works like a business bookkeeper. It tracks where money is, where it comes from, where it goes, reserves (tax, ma'aser, emergency), goals, net worth and reports.

The product principle: **the app does the work and only asks when it isn't sure.** Daily effort for a family should be under a minute: answer a few questions, send the odd receipt photo or cash note.

Every feature in the original brief is in scope for the first build: accounts, transactions, categories, rules, reserves, goals, net worth, dashboard, reports, exports, audit trail and settings, plus the AI bookkeeper layer (auto-categorisation, question digest, receipts, cash notes). The plan is to build it all in a first working version, then improve page by page.

---

## 2. Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | One responsive web app, phone and desktop | One codebase; covers kosher-phone users on a computer. Native or installable app later if earned. |
| Data in, first | CSV import | No aggregator needed to build and test. CSV stays as a permanent feature. |
| Open Banking | Last phase | Same pipeline as CSV; plugs in without changing anything else. |
| Database | Local SQLite + migrations + seed script while building; hosted Postgres when data needs to persist | Works on any machine in seconds. The switch rewrites the Drizzle schema files (schemas are per-database) and copies the data, so the portability rules in section 3 keep it mechanical. |
| Available cash | Liquid accounts (current, savings, cash wallet) − reserves − ma'aser owed. Credit card balances are not subtracted | Agreed in eng review. |
| Mortgages and loans | The whole monthly payment is an expense (Housing: Mortgage, etc.). The amount owed comes from manual valuations | Bank CSVs only show the total; families think of it as a monthly cost. |
| Refund timing | A refund reduces the original purchase's category in the month the refund arrives | Past months and sent summaries never change. |
| Users | One login per household for now; data model supports multiple members and roles from day one | Family logins come later without a migration rewrite. |
| Onboarding | Pausable at every step, progress saved per household | Families stop and start; anyone in the household can resume. |
| Channels | In-app first, then email and SMS as the backbone, WhatsApp optional | Some users have no WhatsApp. |
| Tags, events, people | Entered by the user only; never inferred | Agreed with client. |
| Build tool | Claude Code with gstack | Real codebase, testable money logic. |

---

## 3. Tech stack (reviewed)

- **Framework:** Next.js (App Router) + TypeScript, run with Bun
- **UI:** Tailwind CSS + shadcn/ui, following `docs/DESIGN.md`
- **Database:** SQLite via Drizzle ORM; Postgres later (Neon or Supabase). SQLite runs in WAL mode with a 5s busy timeout, because the web app and the worker both write.
- **Portability rules (so the Postgres move stays mechanical):** text IDs (ULID); money as integer pence; dates as `YYYY-MM-DD` text and timestamps as ISO UTC text; booleans via Drizzle's boolean mode; upserts via Drizzle `onConflict` (never `INSERT OR REPLACE`); no SQLite-only functions; all database access through one `db` module; schema in one folder.
- **Validation:** Zod at every boundary (CSV rows, AI output, form input, message replies)
- **AI:** Claude API for categorisation, merchant lookup, receipt reading and cash-note parsing, behind one `ai` module with a mock provider for tests and offline work. The `ai` module builds every payload itself: the description with account numbers, sort codes, card numbers and long digit runs masked, plus amount, date, direction and account type. Never balances, household or member names, or other transactions unless the task needs them (receipt matching sends candidate amounts and dates only). Web lookup sends the normalised merchant name only. Redaction has unit tests.
- **Messaging:** a `channels` module with providers for in-app, email and SMS/WhatsApp. Dev uses a console/in-app provider; real providers (e.g. Resend/Postmark for email, Twilio for SMS/WhatsApp) added in Phase 10
- **Files:** local disk in dev, object storage later (receipts, voice notes)
- **Background work:** a `jobs` table (type, payload, status, attempts, run_after, last_error) and one Bun worker process (`bun run worker`). Jobs are idempotent and retry with backoff. Import stores rows inside the request, then queues categorisation. If the AI is down, rows stay unconfirmed and the job retries. The worker also enqueues scheduled work (digests, month end) on a timer.
- **Testing:** Vitest for the engine and money logic, with property-based tests (fast-check) for the invariants: split sums, transfer pairs summing to zero, re-import adding nothing, rounding, and ledger rebuild-from-date matching a full rebuild. A two-household fixture proves every query is scoped. gstack /qa for pages.
- **Auth:** simple single-household login or dev bypass in Phase 1; real auth before any real data

---

## 4. Accounting rules (non-negotiable)

These must hold everywhere: engine, reports, dashboard, exports. Each one gets automated tests.

1. **Money is integer pence.** Never floats. Format to £ only at display. Any percentage (ma'aser, reserve funding) goes through one rounding helper: applied per posting, rounded half away from zero to whole pence.
2. **Signed amounts.** Money in is positive, money out is negative, from the account's point of view. A credit card purchase is negative on the card; a repayment is positive on the card. Liability balances are negative.
3. **Transfers are never income or spending.** A transfer is a transaction in a category of kind `transfer`. Its two sides share a `transfer_group_id`, sit on different accounts of the same household, and sum to exactly zero (any fee is a separate expense). A side whose partner has not arrived yet is an *unpaired transfer*: still excluded from income and spending; after 10 days it becomes a question. Credit card repayments are transfers. A transfer to an own account we don't import (pension, ISA elsewhere, a child's account) is paired with a manual account: confirming it creates or reuses a manual account and posts the matching other side there automatically (source `system`). Mortgage and loan payments are **not** transfers; they are expenses (section 2).
4. **Refunds reduce the original expense, in the month the refund arrives.** A refund links to its purchase (`refund_of_id`) and takes the purchase's category; if the purchase was split, the refund is split in the same proportions. Partial refunds are allowed. Refunds linked to one purchase may not exceed it (otherwise a question). A refund with no matching purchase in the imported history gets a best-guess expense category and a question. A refund is never income, and past months never change.
5. **Splits must balance.** A transaction has split lines only when it is split; otherwise its single category sits on the transaction (`category_id`). When split lines exist they sum exactly to the transaction amount, checked on every write. Every total reads categories through one shared helper that returns the stored splits or the single implicit split, so no query handles the two shapes itself.
6. **Reserves are virtual.** They are allocations on top of real accounts, not accounts. **Available cash = liquid account balances (current, savings, cash wallet) − total allocated to reserves − ma'aser owed.** Credit card balances are not subtracted. Available cash may go negative; Home then shows a calm warning. Spending marked against a reserve (`reserve_id` on the transaction or split) releases that amount from it automatically.
7. **Ma'aser accrues automatically.** Each income line in a category whose ma'aser effect is `accrue` adds the household's percentage of the amount actually received (net). Each payment in a category whose effect is `reduce` lowers ma'aser owed by its full amount. Families who give on gross add manual adjustments. Settings are dated (`effective_from`): a change applies from that date forward and never rewrites earlier entries. Overpaying carries forward: owed can go below zero and shows as "ahead by £x". Ambiguous charity payments become a Y/N question.
8. **Cash is tracked as a wallet account.** A withdrawal is a transfer from bank to the cash wallet. Cash notes create expenses from the wallet. At month end, all withdrawn cash not covered by notes becomes one system transaction, "General cash spending", and the wallet resets to zero. If the family reports how much cash is actually on hand, only the difference is swept. The sweep is recalculated (with an audit entry) when a late note for that month arrives.
9. **Nothing is silently overwritten.** Every user or system change to financial data writes an audit entry (entity, id, before and after as JSON, actor, reason, time) in the same database transaction as the change. An import is logged once per batch, not per row. The audit log is append-only. Financial rows are never hard-deleted (`deleted_at`).
10. **Imports are idempotent.** Importing the same data twice, from CSV or Open Banking, never creates duplicates. An external id is matched first. Otherwise the key is account + date + amount + normalised description, with an occurrence number, so two genuine £3.20 coffees on the same day both import, and re-importing the file adds neither again. A unique index on (account, dedupe key, occurrence) enforces this in the database. Near matches from a different source or format (same account and amount, date within 3 days, different description) are not dropped: they become a "duplicate?" question.
11. **Balances can be checked.** Each account has an opening balance *as at a date*; its balance on any date is that opening balance plus booked transactions after it. Balances the bank reports (CSV running balance, statement closing balance, or entered by hand) are stored as checkpoints. Any difference between our figure and a checkpoint is shown on the account and on Home, with the date it started.
12. **Pending rows don't count.** Transactions have a booking status (`pending`, `booked`). CSV and manual rows are booked. Pending rows (Open Banking) show in Activity but are left out of balances, totals, reports and ledgers.
13. **Ledgers follow their source.** Automatic ma'aser and reserve entries are rebuilt from transactions whenever a source transaction, split or setting changes, so recategorising a payment corrects ma'aser owed. Manual entries are never touched by a rebuild.

### Dates

Transaction dates are the bank's booking date as `YYYY-MM-DD` (UK local date, no time). Months and financial years are worked out from that date string, never from timestamps. The financial year start is configurable per household (month and day), defaulting to 6 April.

---

## 5. Data model (reviewed)

Every household-owned table carries `household_id`, and every query is scoped by it. All money columns are integer pence. IDs are text ULIDs. Financial rows are soft-deleted (`deleted_at`), never removed.

**People and access**
- `households` — name, currency (GBP), financial year start (month, day; default 6 April), onboarding progress
- `users` — login identity
- `household_members` — user ↔ household, role (owner, member, viewer), notification phone/email

**Money**
- `accounts` — type (current, savings, credit card, cash wallet, loan, mortgage, investment, other asset), name, institution, opening_balance, opening_balance_date, is_liquid, include_in_net_worth, is_manual (accounts we don't import, e.g. a pension or ISA elsewhere). Loan and mortgage accounts hold no transactions; their value comes from `manual_valuations`.
- `transactions` — account, date, amount, raw description, merchant, category_id (used when there are no split lines), source (csv, open_banking, manual, cash_note, receipt, system), booking_status (pending, booked), external_id, dedupe_key, dedupe_occurrence, import_batch, status (auto, confirmed, unconfirmed), confidence, transfer_group_id, refund_of_id, reserve_id, notes, deleted_at. Unique index on (account, dedupe_key, dedupe_occurrence).
- `transaction_splits` — transaction, category, amount, reserve_id, note. Present only when a transaction is split; the lines sum exactly to the transaction amount.
- `categories` — name, parent, kind (income, expense, transfer), maaser_effect (accrue, reduce, none), system or custom. Charity is an ordinary expense category with maaser_effect `reduce`.
- `balance_checkpoints` — account, date, bank-reported balance, source (csv running balance, statement, manual)
- `manual_valuations` — for net worth: asset or liability value at a date (house, pension, car, mortgage, loan)

**Learning**
- `merchants` — shared across all households: canonical name, match patterns (from the normalised merchant name only), web lookup result, suggested category, lookup date. Rows are created only for merchants a web lookup confirms as a business, from card-payment style lines. Never from transfers, standing orders or direct debits to a person, and never from a household's answers or corrections.
- `household_merchants` — household override: merchant ↔ household category, confirmed flag. Every household-specific mapping lives here or in rules.
- `rules` — conditions (merchant, description pattern, amount range, account, direction), actions (category, split template, mark as transfer, ma'aser treatment), priority, origin (onboarding, answer, correction, manual), enabled. Rules never apply tags, events or people.

**Bookkeeper loop**
- `questions` — subject (a transaction, a household merchant, or a transfer pair), question type (category, transfer, ma'aser, receipt match, duplicate, refund), options, status (open, sent, answered, expired, fallback), answer, answered_by, channel. At most one open question per subject; answering a merchant question confirms all of that merchant's unconfirmed transactions.
- `digests` — batch of questions sent together: channel, recipient, sent_at, reply raw text
- `receipts` — file, source (upload, email), parsed merchant/date/total, line items, matched transaction, match confidence
- `cash_notes` — raw text or voice file, transcript, parsed expenses, status

**Optional detail (user-entered only)**
- `tags`, `transaction_tags`
- `events` (projects such as a simcha or holiday), `transaction_events`
- `persons` (person tracking), `transaction_persons`

**Planning**
- `reserves` — name, type (tax, emergency, custom), target, funding rule (manual, % of income, fixed monthly)
- `reserve_movements` — allocations and releases; origin (auto, manual); source transaction or split for automatic entries
- `maaser_settings` — percentage, effective_from; which income and payments count is set per category (`maaser_effect`)
- `maaser_ledger` — accruals, reductions and manual adjustments (opening balance, gross top-ups); origin (auto, manual); source transaction or split for automatic entries
- `goals` — name, target amount, target date, linked reserve or account, progress method

Automatic rows in `maaser_ledger` and `reserve_movements` are a projection: rebuilt (as a job) whenever their source transaction, split or setting changes. Manual rows are kept as entered.

**Plumbing**
- `bank_profiles` — saved CSV column mapping per bank/format: date column and format, amount or debit/credit columns, sign convention, description columns, running-balance column (optional), header row
- `import_batches` — file, profile, account, row counts (new, duplicate, near-duplicate, error), status, undone_at. Undo is always available: after a warning listing confirmed or edited rows, it soft-deletes the batch's transactions, returns receipts to unmatched, closes their open questions, unpairs transfers (the surviving side becomes an unpaired transfer), unlinks refunds (the refund gets a question) and rebuilds the ledgers. Rules created from answers stay.
- `jobs` — type, payload, status, attempts, run_after, last_error
- `audit_log` — entity, entity id, before (JSON), after (JSON), actor (user or system), reason, timestamp, import_batch (for batch-level entries). Append-only.

---

## 6. Navigation and screens

Primary navigation (bottom bar on phone, sidebar on desktop):

| Area | Purpose | Key contents |
| --- | --- | --- |
| **Home** | "How are we doing?" at a glance | Available cash, net worth, this month in vs out compared with last month, ma'aser owed, reserves, goals, open questions count, setup checklist until onboarding is complete |
| **Activity** | Every transaction | Search and filters (account, category, date, status, tag, event), unconfirmed flag, transaction detail with receipt, splits, tags, audit history; bulk select and tag; questions inbox |
| **Plan** | Money set aside | Reserves with balances and targets, ma'aser owed with ledger and history, goals with progress |
| **Reports** | Understanding over time | Monthly summary, spending by category over time, income sources, events/projects totals, net worth over time, exports (CSV, PDF) |
| **Settings** | Controls | Accounts and imports, categories, rules, channels and recipients, ma'aser and tax settings, financial year, household members, audit trail |

Always available: a **capture button** (upload receipt, add cash note, add manual transaction) and the **questions inbox** badge.

Screen list:
1. Login
2. Onboarding (multi-step, resumable)
3. Home
4. Activity list
5. Transaction detail (drawer or page)
6. Questions inbox
7. Capture: receipt upload, cash note, manual transaction
8. Plan: reserves, reserve detail
9. Plan: ma'aser overview and ledger
10. Plan: goals, goal detail
11. Accounts list and account detail (balance history, imports)
12. CSV import wizard (upload, map columns, preview, confirm, result)
13. Net worth (accounts plus manual valuations)
14. Reports: monthly summary, category trends, events, exports
15. Settings: categories, rules, channels, ma'aser and tax, financial year, members, audit trail

---

## 7. Onboarding flow

Pausable at every step. Progress saved per household. The app is usable as soon as step 2 completes; a setup checklist sits on Home until the rest is done. Anything skipped flows into the normal question digest.

1. **Household basics** — household name, financial year start, who gets questions (email/phone).
2. **Add accounts and import history** — for each account: create it, upload 6–12 months of CSV (Open Banking later), map columns (saved as a bank profile), import. Cash wallet created automatically.
3. **Sorting** — the engine categorises everything, looks up unknown merchants, detects transfers and refunds. Show progress; let them leave and come back.
4. **Confirm income** — detected income sources: confirm, rename, mark whether it counts for ma'aser.
5. **Confirm fixed costs** — mortgage, utilities, subscriptions, insurance detected as recurring: confirm or correct.
6. **Confirm regular shops** — only the merchants covering most of the spending (roughly the top 80% by value); the rest go to the digest over the coming weeks.
7. **Confirm transfers** — uncertain transfer pairs and card repayments: Y/N.
8. **Ma'aser and reserves** — ma'aser percentage and rules, opening ma'aser balance, tax reserve method, emergency fund target.
9. **Goals (optional)** — add any goals now or later.
10. **Channels** — choose SMS, email or WhatsApp; send a test question; set preferred time for the daily digest.
11. **Done** — land on Home with everything up to date.

Every confirmation creates a rule.

---

## 8. Core workflows

1. **Import** — CSV (or Open Banking) → normalise → dedupe → store → categorise → questions for low confidence. Storing happens inside the request; everything after it runs as jobs:

```
 upload CSV ──► parse with bank profile ──► Zod-validate rows ──► normalise
                    │ bad rows → counted as errors in the batch
                    ▼
 dedupe:  external_id match? ── yes ─► skip (duplicate)
            │ no
          (account, date, amount, normalised description, occurrence) exists? ── yes ─► skip
            │ no
          near match from another source (same amount, ±3 days)? ── yes ─► store + "duplicate?" question
            │ no
          store (booked, unconfirmed) + running balance → balance_checkpoints
            │  one DB transaction, one batch audit entry
            ▼
 enqueue job: categorise ──► rules → household merchant → shared merchant → AI (redacted payload)
            │ AI down → leave unconfirmed, retry with backoff
            ▼
 enqueue jobs: transfer pairing, refund matching, ledger rebuild (ma'aser, reserves), balance drift check
            ▼
 questions for low confidence ──► inbox / digest
```
2. **Categorise** — apply household rules → household merchant mapping → shared merchant suggestion → AI with confidence. AI runs once per unique normalised merchant (batched), not per transaction, and the result is reused for every row. Above threshold: status `auto`. Below: create a question; meanwhile store best guess as `unconfirmed`.
3. **Daily digest** — at the household's chosen time, send up to ~5 open questions, ordered by value and age. Replies by number, word or Y/N. Each answer confirms the transaction and creates or strengthens a rule. Unanswered questions expire into fallback (best guess stays, marked unconfirmed).
4. **Correction** — user changes a category in the app → audit entry → offer "always do this for [merchant]?" → rule.
5. **Receipt** — upload or email forward → AI reads merchant, date, total, line items → match to transaction (amount, date window, merchant) → attach; if line items span categories, suggest a split for the user to accept.
6. **Cash** — withdrawal moves money to cash wallet → text or voice note ("40 for the cleaner, 20 taxis") → AI parses into wallet expenses → month end: unnoted cash becomes one General cash spending transaction (or only the difference, if the family reports cash on hand); a late note for that month reduces the sweep.
7. **Ma'aser** — qualifying income posts an accrual; qualifying charity payment posts a reduction; ambiguous charity payments become a Y/N question.
8. **Reserves** — funding rules allocate on income or monthly; spending against a reserve releases it; available cash updates.
9. **Month end** — cash sweep, monthly summary generated and sent, comparison with previous month.
10. **Catch-up** — user filters a period, bulk-tags events/people, reviews unconfirmed items.
11. **Re-consent** (Open Banking phase) — warn ahead of connection expiry; flag stale accounts on Home.

---

### Phase 1 decisions (16 Oct 2026, while building Phase 1)

- **SQLite driver:** `@libsql/client` with `drizzle-orm/libsql`. One driver for the Next server, the worker, scripts and tests; prebuilt binaries from npm (no native build on a new machine); async like Postgres. Busy timeout (5s) set on every pooled connection through the client's `timeout` option; WAL set once on the file. Transactions use `BEGIN IMMEDIATE`, so concurrent writers wait instead of failing.
- **Seed stored raw:** the seed writes transactions as a bank import would leave them: booked, uncategorised, `unconfirmed`, no transfer or refund links. Sorting them is Phase 3. The generator (`src/seed/generate.ts`) keeps each row's intended category, transfer partner and refund target in memory for Phase 3's tests; they are never stored.
- **Seed transactions use import batches:** one `import_batches` row per account (`seed-<account>.csv`), audited once per batch, as a real import will be.
- **`jobs.household_id` is nullable** for global jobs (e.g. a scheduler tick); household jobs always carry it. Job state changes are plumbing and are not audit-logged; the work a job does is audited by the code it calls.
- **Audit helper API** (`src/audit`): `insertAudited`, `insertBatchAudited`, `updateAudited` (household-scoped), `softDeleteAudited`. Each writes the change and its entry in one transaction. Nothing updates or deletes `audit_log`; a test checks this.
- **Dev login:** `/login` has one button, "Continue as the demo household". It sets an HMAC-signed, httpOnly cookie with the user and household ids (30 days). Enabled when `NODE_ENV` is not production or `FFCC_DEV_LOGIN=1`. Production refuses to start a session without `SESSION_SECRET`. `src/proxy.ts` (Next 16's middleware) sends anyone without a valid session to `/login`.
- **Money helpers ahead of Phase 3:** `formatMoney`, `applyRate` (the one rounding helper: half away from zero, integer maths) and `parseAmountToPence` exist with tests, so later phases share them.
- **Screen check:** `bun run check:screens` proves the Phase 1 "done when" for screens at 320, 375 and 1280px.
- **Description normalisation for dedupe** (`src/import/dedupe.ts`, after /code-review): NFC, lower case, combining marks removed, then anything that is not a Unicode letter or digit becomes a space. Hebrew and accented letters are kept ("café", "צדקה"); Hebrew with and without vowel points match. English results are unchanged.
- **Stuck jobs:** a job whose worker dies on every attempt is marked `failed` ("The worker stopped while running this job.") once it reaches max attempts, instead of being reclaimed forever. "Sorting is paused" also shows when a job has been `running` for over 10 minutes.
- **Sessions are checked against the database:** a signed cookie is only accepted while its user is still a member of its household; otherwise the person is sent to `/login?expired=1`. Public paths (`/login`, `/login/…`, `/icon.svg`, `/favicon.ico`) are matched by whole segment in `src/auth/public-paths.ts`.
- **Audit helper guards:** a batch insert refuses rows for any other household, and an update may not change a row's `id` or `householdId`.
- **Money signs:** `moneySign` is the one sign rule; `formatMoney` and hero figures both use it, so `+` (in) and `−` (out) show at every size.

### Phase 2 decisions (16 Oct 2026, while building Phase 2)

- **Pipeline** (`src/import/`): `csv.ts` (RFC 4180 parser) → `detect.ts` (header row, layout signature, saved profile → built-in preset → guess) → `normalise.ts` (Zod-validated rows in date order; unreadable rows reported with row number and reason) → `dedupe.ts` `classifyRows` → `pipeline.ts` (`prepareImport` dry run, `runImport` in one transaction) → `undo.ts` → `drift.ts`. Nothing downstream knows the rows came from a CSV.
- **Dates and amounts**: dd/mm/yyyy, dd/mm/yy, yyyy-mm-dd, dd-mm-yyyy, "2 Jan 2026", "2 Jan 26"; impossible dates rejected. Amounts parsed from text to pence (`£`, commas, signs, brackets). Newest-first files are put into date order before occurrence numbers and balances are worked out. Files are read as UTF-8, falling back to Windows-1252.
- **Near duplicate** (rule 10): same account and amount, date within 3 days, different normalised description, and the existing row came from a different source (not `csv`) or a different file layout (bank profile header signature). Stored, with an open "duplicate?" question (options "Keep both" / "It’s the same payment"). Same-layout near matches are ordinary separate payments.
- **Dedupe index is partial** (`WHERE deleted_at IS NULL`, migration 0001), so rows soft-deleted by an undo never block re-importing the same file. Checkpoints have the same partial unique index on (account, date, source); bank profiles are unique per (household, header signature).
- **Balances**: the end-of-day balance (last row of each day in date order) becomes a `csv_running_balance` checkpoint, once per day. An account with no transactions takes its opening balance from the first reported balance, dated the day before the file starts. Difference = our balance − the bank’s at the latest checkpoint; "since" is the first differing checkpoint after the last matching one. Shown on Settings → Accounts and on each import.
- **Presets** (`src/import/presets.ts`): Barclays-, Nationwide-, Monzo- and Amex-style layouts, modelled on how those banks describe their exports, not verified against real files. A preset is matched on its exact column names; plain `Date,Description,Amount` files are deliberately not matched to a preset and are guessed from the data instead (a column with no negative values suggests a card statement). The family always sees and can change the mapping.
- **Wizard state lives in the browser**: the file text and mapping are held by the client component and sent to Zod-validated server actions (`analyseUpload`, `previewImportAction`, `confirmImportAction`), capped at 5 MB. A new account can be created in step 1; it is created in the same transaction as the import.
- **Jobs**: an import queues `categorise_batch`; an undo queues `ledger_rebuild`. Both handlers are no-ops until Phase 3.
- **Undo audit**: the batch’s own rows are changed with `updateBatchAudited` (one entry listing the ids); each changed row outside the batch (surviving transfer side, unlinked refund, released receipt) gets its own entry.
- **Early read-only Activity list**: date, account, description, amount; newest first, 50 at a time, filter by import. Search, filters, detail and editing stay in Phase 4.
- **Sample files**: `fixtures/csv/` (generated by `bun run fixtures` from `tests/fixtures/csv-sources.ts`; a test checks they match).

### Phase 3 decisions (16 Oct 2026, while building Phase 3)

- **Mock AI only.** All AI calls go through `src/ai`. `getAiProvider()` returns a deterministic mock (a keyword table in English and Hebrew; unknown merchants get a low-confidence guess so questions are exercised). `AI_PROVIDER=claude` fails with "not available yet": nothing in setup, tests or the worker needs the Claude API. Payloads are built and redacted in `src/ai/redact.ts`; responses are Zod-validated, and unknown categories or keys are ignored.
- **Auto-file threshold: 80** (`AUTO_FILE_THRESHOLD`, open question in section 11 now set). At or above, a row is filed with status `auto`; below, it keeps the best guess as `unconfirmed` and one question is asked per merchant (`household_merchants` subject). A low-confidence Charity guess asks the ma'aser Y/N question instead.
- **Engine order** (`src/engine/run.ts`): merchant names → household rules (lower priority number first) and confirmed merchant mappings → transfer pairs → shared merchants, web lookup, then the AI once per unique merchant (batched) → refunds → unpaired-transfer questions (after 10 days) → month-end cash sweep → ledger rebuild. Decisions are planned in memory (the AI is never called inside a database transaction) and written in one audited transaction. Confirmed rows are never changed; running it again with nothing new writes nothing.
- **Transfer pairs**: equal and opposite amounts on two different own accounts within 3 days. Sure (status `auto`) when either description says it is a transfer (TRANSFER, העברה, PAYMENT RECEIVED, ATM, …); otherwise paired as `unconfirmed` with a Y/N question. Two equally good partners: no pair, a question instead. Category from the accounts: a credit card side → Credit card repayment; a cash wallet side → Cash withdrawal; otherwise Transfer. Rows a household rule files elsewhere (the mortgage) are never paired.
- **Cash withdrawals with no wallet row** (e.g. a bank CSV on its own): the engine posts the cash wallet side itself (source `system`), creating the household's cash wallet if needed, so rule 8 holds.
- **Refunds**: positive rows that say refund (REFUND, RFND, החזר) or match an earlier purchase from the same merchant on the same account, within 120 days. Exact remaining amount first. If several purchases could each have been partly refunded, the refund is linked to the most recent as a best guess, marked unconfirmed, and the family is asked which (the category is the same either way). Too large → question; no purchase → best-guess expense category and a question.
- **Cash sweep** runs for completed months only. A counted cash-on-hand figure is a parameter for now; storing counts and cash notes comes in Phase 12.
- **Shared merchant list**: rows are added only from a web lookup of a card-style business line: money out, no transfer, standing order or direct debit wording. Never from transfers, payments to people, money in, or household answers.
- **Ledger rebuilds** compare the new automatic entries with the existing ones and write nothing if they match; otherwise the old ones are soft-deleted and the new ones inserted, one audit entry per ledger. `insertBatchAudited` now takes a general `batchId`.
- **Jobs**: `categorise_batch` runs the engine (mock AI); if the AI fails it throws so the job retries. `ledger_rebuild` rebuilds from the given date. `bun run setup` runs the engine on the seed.
- **Sample CSVs** now link up (a card payment, a monthly transfer between two of the accounts, and a purchase with a partial refund) so cross-file transfers and refunds can be tested. `bun run engine:report` prints what the engine did on the seed and the sample files.
- **Activity list** shows category and status (Auto, Confirmed, Not sure), and marks transfers (Transfer / Card repayment / Cash withdrawal, muted amount with no sign, "Unpaired" if alone), refunds ("Refund") and refunded purchases ("Refunded").

## 9. Build phases

Each phase ends with tests passing, /review, /qa (for anything with a screen), /design-review (for screens) and /ship. Acceptance checks are what "done" means.

**Phase 0 — Setup**
- Repo on GitHub, gstack copied into the project, `CLAUDE.md`, docs folder.
- /plan-eng-review on this plan; save the agreed version here.
- /design-consultation → `docs/DESIGN.md`.
- Done when: plan reviewed and updated, design system written.

**Phase 1 — Foundation**
- Next.js app, Tailwind, shadcn/ui themed from DESIGN.md.
- Drizzle + SQLite (WAL mode, busy timeout), first migrations for the full data model in section 5, following the portability rules in section 3.
- `jobs` table and the worker process (`bun run worker`). Home shows "sorting paused" if the oldest pending job is over 10 minutes old.
- Indexes: (household_id, date), (account_id, date), transfer_group_id, refund_of_id, questions (household_id, status), jobs (status, run_after), and the dedupe unique index.
- Seed script: one dummy household, 12 months, current account, savings, credit card, cash wallet; salary, mortgage, utilities, groceries, fuel, subscriptions, charity, card repayments, transfers, a few refunds.
- App shell with the five navigation areas (empty states), dev login.
- Audit log helper used by every write.
- Done when: `bun run setup` builds the DB and seed on any machine; all five areas load on phone and desktop widths.
- Status: **built 16 Oct 2026** (decisions above).

**Phase 2 — CSV import**
- Import wizard: upload, column mapping, preview first 20 rows, sign convention, confirm.
- Saved bank profiles; auto-detect a known format.
- Duplicate detection per rule 10: external id, then account + date + amount + normalised description with occurrence numbers; near matches across sources become questions.
- Running-balance column mapped to balance checkpoints; drift shown per account.
- Import batch summary and undo (always available, with cleanup per section 5).
- Done when: importing the same file twice adds nothing; two identical same-day rows both import once; three different bank formats import correctly; undo after confirmations leaves no orphaned receipts, pairs or ledger entries.
- Status: **built 16 Oct 2026** (decisions above).

**Phase 3 — Engine**
- Merchant normalisation and shared merchant table.
- Rules engine with priority.
- AI categorisation with confidence (mock provider in tests).
- Merchant web lookup (cached in shared table).
- Transfer pair detection; credit card repayment detection.
- Refund matching.
- Splits.
- Ma'aser ledger and reserve ledger recalculation.
- Done when: every accounting rule in section 4 has passing tests; the seed household categorises with transfers and refunds correctly handled.
- Status: **built 16 Oct 2026** (decisions above). Tests per rule in `tests/rules/`.

**Phase 4 — Activity**
- List, search, filters, transaction detail, edit category, splits, tags, events, people, audit history, bulk tag, unconfirmed flag.
- Correction → "always do this?" → rule.
- Done when: a user can find any transaction, fix it, and see the rule it created.

**Phase 5 — Home**
- Available cash, net worth, month vs last month, ma'aser owed, reserves, goals, open questions, setup checklist.
- Done when: every figure on Home reconciles with Activity and Plan.

**Phase 6 — Plan**
- Reserves (create, fund, release, targets), ma'aser overview and ledger, goals.
- Done when: available cash changes correctly as reserves and ma'aser move.

**Phase 7 — Accounts and net worth**
- Accounts list and detail, balance history, manual valuations, net worth over time.

**Phase 8 — Settings**
- Categories, rules (view, edit, disable), channels and recipients, ma'aser and tax settings, financial year, members, audit trail viewer.

**Phase 9 — Onboarding**
- The full flow in section 7, resumable, with the Home checklist.
- Done when: a new household can go from empty to a sorted dashboard using only CSVs, stopping and resuming at any step.

**Phase 10 — Question digest**
- In-app questions inbox first, then email, then SMS; WhatsApp optional.
- Reply parsing (number, word, Y/N), answer → rule, expiry → fallback, ~5 per digest, preferred time.
- Done when: a question can be answered from each channel and the rule applies to the next matching transaction.

**Phase 11 — Receipts**
- Upload and email forwarding, AI extraction, auto-match, split suggestions, receipt viewer on transactions.

**Phase 12 — Cash**
- Cash wallet, text and voice notes, parsing into expenses, month-end sweep.

**Phase 13 — Reports and exports**
- Monthly summary (in app and sent by channel), category trends, events totals, net worth over time, CSV and PDF exports.

**Phase 14 — Open Banking**
- Regulated aggregator integration feeding the same import pipeline, re-consent handling, stale-connection warnings.

**Phase 15 — Later**
- Separate family logins and permissions, hosted Postgres migration (if not done earlier), installable/native app, community product decisions.

---

## 10. Dummy data

- Seed script creates a realistic household so every screen has content from Phase 1.
- Sample CSVs in `fixtures/csv/` in at least three different bank formats, including overlapping date ranges to test dedupe.
- Real exports, if used, must be anonymised and never committed with real names or account numbers.

---

## 11. Open questions

- Tax reserve method: flat percentage or estimate.
- One family or a community product (affects pricing, onboarding, merchant sharing across households).
- Digest size. (AI auto-file threshold set to 80 in Phase 3; revisit with real data.)
- Data retention and security standard before any real data goes in.
- Ma'aser display: shown as its own line on Home and still deducted from available cash (current plan).

Settled in the eng review (see Appendix A): ma'aser basis (net received, per-category, dated settings, overpayment carries forward, gross givers use manual adjustments, opening balance as a manual entry); financial year (configurable per household, default 6 April).

---

## 12. Working method with gstack

- Kickoff: /plan-eng-review on this plan, /design-consultation for the design system. Optional /office-hours first.
- Per feature: fresh session → build → look in browser → /review → /qa → /design-review → fix → /ship → push.
- Bugs: /investigate.
- One feature per session. Push before leaving a machine. Update this file when decisions change.

---

## Appendix A — Engineering review record (/plan-eng-review, 16 Oct 2026)

Target: `docs/BUILD_PLAN.md` (this file). Reviewer: Claude via gstack /plan-eng-review. Focus requested: section 4 (accounting rules) and section 5 (data model).

### Binding decisions carried in (user answers, this session, before the skill ran)
- Database: keep SQLite now, migrate to hosted Postgres later.
- Available cash = liquid accounts (current, savings, cash wallet) − reserves − ma'aser owed. Credit card balances are not subtracted.
- Mortgage and loan payments count in full as an expense; the liability balance comes from manual valuations.
- Refunds reduce the original purchase's category in the month the refund arrives; never income.

### Scope record
feature answers: no feature cuts proposed (all features in scope per section 1, binding); structure: A) Original arrangement (answer to D4); accepted scope: data model tables as listed in section 5, including `household_merchants` and separate tags/events/persons tables; pending remedies: R1 onwards.
Correction (factual, no behaviour change): the D4 brief said the plan never states whether rules or `household_merchants` win. It does: section 8 workflow 2 orders rules → household merchant mapping → shared merchant → AI.
Scope Challenge result: scope accepted as-is.

## Decision ledger

Line numbers cited in this ledger (e.g. `BUILD_PLAN.md:84`) refer to version 1 of this file, commit 7b1a26f.

### R1: Postgres portability guardrails
Finding: S1, P2, confidence 8/10, BUILD_PLAN.md:32 ("ORM keeps the switch to Postgres small"), reviewer: Claude. Drizzle schemas are dialect-specific (`sqliteTable` from `drizzle-orm/sqlite-core` vs `pgTable` from `drizzle-orm/pg-core`); the switch means rewriting the schema files and regenerating migrations, and drizzle-kit does not move rows.
Plan baseline: SQLite now, Postgres later (user answer, this session). No portability rules stated.
Runtime evidence: no code exists yet (repo holds docs and gstack only).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 portability guardrails | none stated | adopt the rules below and correct line 32 | none; line 32 left as is |
| Database choice | SQLite now, Postgres later (approved) | unchanged | unchanged |
| R2+ remedies | pending | pending | pending |
Question D5:
D5 — Write portability rules so the later Postgres move stays mechanical?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 2/3.
ELI10: You chose SQLite now and Postgres later. That move rewrites the schema files whatever we do, but a few habits decide whether it is an afternoon or a week: ID format, how dates and booleans are stored, and never using SQLite-only SQL. Writing them down now costs nothing.
Stakes if we pick wrong: without rules, SQLite-only shortcuts creep into money code and the move needs re-testing every query.
Recommendation: A because the rules are free now and expensive to retrofit.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Adopt guardrails (recommended)
  ✅ The Postgres move becomes a schema-file swap plus a data copy, with no query rewrites
  ✅ Money and date handling stay identical on both databases, so tests stay valid
  ❌ Slightly more verbose schema code than idiomatic SQLite (text IDs, explicit modes)
B) No guardrails
  ✅ Nothing to remember while building the early phases
  ❌ SQLite-only shortcuts are found only when the move breaks something
Net: a few written rules now against an unbounded clean-up later.
Header: Portability
Options:
A) Adopt guardrails (recommended)
Text IDs (ULID), integer pence, dates as 'YYYY-MM-DD' text and timestamps as ISO UTC text, booleans via Drizzle's boolean mode, upserts via Drizzle onConflict (no INSERT OR REPLACE), no SQLite-only functions, all DB access through one `db` module, schema in one folder. Correct line 32 to say the move means a schema rewrite plus a data copy. (human: ~1h / CC: ~5 min)
B) No guardrails
Leave the plan as written; deal with portability at migration time.

State: approved
Actual answer: A) Adopt guardrails (D5, user answer)
Accepted scope: Text IDs (ULID), integer pence, dates as 'YYYY-MM-DD' text and timestamps as ISO UTC text, booleans via Drizzle boolean mode, upserts via Drizzle onConflict, no SQLite-only functions, all DB access through one `db` module, schema in one folder; correct line 32.
History: none

### R2: Background job runner and SQLite concurrency
Finding: A1, P1, confidence 8/10, BUILD_PLAN.md:47 ("Background work: a simple job runner for imports, categorisation and digests; upgrade only if needed"), reviewer: Claude. Onboarding imports 6–12 months for several accounts and runs AI on every unknown merchant (BUILD_PLAN.md:157-158); that cannot run inside a web request, and "simple job runner" names no process, storage or retry. With SQLite, a second writing process needs WAL mode and a busy timeout or writes fail with SQLITE_BUSY.
Plan baseline: "a simple job runner", unspecified.
Runtime evidence: no code yet. Web search: a database table as the job queue is the common durable pattern; no SQLite-specific source found (unverified for SQLite).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 job runner | unspecified | `jobs` table + one separate Bun worker process; WAL + 5s busy timeout; idempotent jobs with retry and backoff | jobs run inside the Next.js server process after the response |
| R1 portability | approved A | unchanged (jobs table follows R1 rules) | unchanged |
| R3+ remedies | pending | pending | pending |
Question D6:
D6 — How should background work (imports, AI sorting, digests) run?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 3.
ELI10: Sorting a year of transactions with AI takes minutes, too long for a web page request. The plan says "a simple job runner" without saying where it lives. If jobs live only in the web server's memory, a restart mid-import loses the work and the family sees a half-sorted account. Storing each job as a row in the database and running one small worker program next to the app survives restarts and retries failed AI calls.
Stakes if we pick wrong: lost or doubled work after a restart, and a stuck "Sorting…" screen in onboarding.
Recommendation: A because it survives restarts with no new service, and the jobs table works unchanged on Postgres later.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Jobs table + worker process (recommended)
  ✅ A restart or crash resumes pending jobs; nothing is lost or run twice (jobs are idempotent)
  ✅ AI outages just delay sorting: rows stay unconfirmed and the job retries with backoff
  ❌ One more process to start (`bun run worker`), and SQLite needs WAL mode for two writers
B) Run inside the web server
  ✅ One process, nothing extra to start in development
  ❌ Work is lost on restart or deploy; long imports can hit platform time limits
Net: one extra process for durable, retryable background work. (human: ~1 day / CC: ~30 min for A)
Header: Job runner
Options:
A) Jobs table + worker (recommended)
A `jobs` table (type, payload, status, attempts, run_after, last_error) and one Bun worker process. SQLite in WAL mode with a 5s busy timeout and short write transactions. Jobs are idempotent and retry with backoff. Import stores rows in the request, then queues categorisation; AI failure leaves rows unconfirmed. Scheduled work (digests, month end) is enqueued by the worker on a timer.
B) Inside the web server
Run background work in the Next.js process after responding; no jobs table or worker.

State: approved
Actual answer: A) Jobs table + worker (D6, user answer)
Accepted scope: `jobs` table (type, payload, status, attempts, run_after, last_error) and one Bun worker process; SQLite WAL mode, 5s busy timeout, short write transactions; idempotent jobs with retry and backoff; import stores rows in the request then queues categorisation; AI failure leaves rows unconfirmed; worker enqueues scheduled work (digests, month end) on a timer.
History: none

### R3: Shared merchant table privacy
Finding: A2, P1, confidence 8/10, BUILD_PLAN.md:90 ("`merchants` — shared across all households: canonical name, match patterns, web lookup result, suggested category, lookup date"), reviewer: Claude. The plan does not say what may enter the shared table. Bank transfers and standing orders often name private people ("J. Cohen Ltd" in the product note, a cleaner, a relative). If those, or a household's own answers, feed shared match patterns or suggested categories, one family's payees and habits become visible to other families.
Plan baseline: shared table, sources unstated.
Runtime evidence: no code yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 shared table sources | unstated | only businesses confirmed by web lookup; never household answers; never transfers/standing orders to people | as written: any merchant, suggestions may learn from households |
| household_merchants | approved (D4 structure A) | unchanged; holds every household-specific mapping | unchanged |
| R4+ remedies | pending | pending | pending |
Question D7:
D7 — What may go into the merchant list shared by all households?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 5.
ELI10: The shared merchant list saves AI cost: Tesco is looked up once for everyone. But bank lines also name private people, like a cleaner paid by transfer. If those names, or one family's answers ("J. Cohen Ltd is Gifts"), go into the shared list, other families' apps learn them. Keeping the shared list to businesses found by web lookup keeps the saving and removes the leak; each family's own answers stay in their household mapping.
Stakes if we pick wrong: one family's payees and spending habits leak to other households, a serious privacy breach for a finance app.
Recommendation: A because it keeps the cost saving with no cross-family leak.
Completeness: A=9/10, B=4/10
Pros / cons:
A) Businesses from web lookup only (recommended)
  ✅ No household's answers or private payee names ever reach another household
  ✅ Still one lookup per business across all families, so AI cost stays low
  ❌ Shared suggestions improve only from lookups, not from families' corrections
B) As written
  ✅ Shared suggestions get better as families confirm categories
  ❌ Private names and one family's choices can surface in another family's app
Net: slightly less clever shared suggestions in exchange for no cross-family leak.
Header: Merchant list
Options:
A) Web-lookup businesses only (recommended)
Shared `merchants` rows are created only for merchants a web lookup confirms as a business, from card-payment style lines. Never from bank transfers, standing orders or direct debits to a person, and never from a household's answers or corrections; those live only in `household_merchants` and rules. Match patterns use the normalised merchant name, never raw descriptions.
B) As written
Leave the shared table's sources unstated; suggestions may learn from households.

State: approved
Actual answer: A) Web-lookup businesses only (D7, user answer)
Accepted scope: shared `merchants` rows only for merchants a web lookup confirms as a business, from card-payment style lines; never from transfers, standing orders or direct debits to a person; never from household answers or corrections (those stay in `household_merchants` and rules); match patterns use the normalised merchant name, never raw descriptions.
History: none

### R4: What bank data the AI may see
Finding: A3, P2, confidence 7/10, BUILD_PLAN.md:45 ("AI: Claude API for categorisation, merchant lookup, receipt reading and cash-note parsing, behind one `ai` module"), reviewer: Claude. CLAUDE.md already bans full descriptions and account numbers from production logs, but nothing limits what is sent to the AI provider or to web search. Bank descriptions often carry sort codes, account numbers, card fragments and references.
Plan baseline: all AI calls through the `ai` module with Zod-validated output; payload contents unstated.
Runtime evidence: no code yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 AI payload | unstated | minimised payload built and redacted inside the `ai` module; web lookup sends the normalised merchant name only | as written |
| R3 shared merchants | approved A | unchanged | unchanged |
| R5+ remedies | pending | pending | pending |
Question D8:
D8 — Limit what bank data is sent to the AI and web search?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 3.
ELI10: To sort a payment the AI needs the description, amount and date. It does not need account numbers, sort codes, card digits, balances or family names, but bank descriptions often contain some of those. One rule in the `ai` module can strip them before anything leaves the app, and send only a shop name to web search.
Stakes if we pick wrong: account numbers and personal details sit in a third party's logs, which is hard to explain to families and harder to undo.
Recommendation: A because it costs one small, testable function and is what families will expect.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Minimise and redact (recommended)
  ✅ No account numbers, sort codes, card digits, balances or names ever leave the app
  ✅ One function in the `ai` module, covered by unit tests, enforces it for every AI call
  ❌ A redacted reference number can occasionally make a description harder to classify
B) As written
  ✅ The AI always sees the full original line
  ❌ Sensitive identifiers are sent to the AI provider and search on every call
Net: a small accuracy risk for a clear privacy promise. (human: ~3h / CC: ~10 min)
Header: AI payload
Options:
A) Minimise and redact (recommended)
The `ai` module builds every payload itself: description with account numbers, sort codes, card numbers and long digit runs masked, plus amount, date, direction and account type. Never balances, household or member names, or other transactions' data unless the task needs it (receipt matching sends candidate amounts and dates only). Web lookup sends the normalised merchant name only. Unit tests cover the redaction.
B) As written
No payload rule beyond Zod-validated output.

State: approved
Actual answer: A) Minimise and redact (D8, user answer)
Accepted scope: the `ai` module builds every payload: description with account numbers, sort codes, card numbers and long digit runs masked, plus amount, date, direction and account type; never balances, household or member names, or other transactions' data unless the task needs it (receipt matching sends candidate amounts and dates only); web lookup sends the normalised merchant name only; unit tests cover redaction.
History: none

### R5: Deleting transactions and undoing an import
Finding: A4, P1, confidence 8/10, BUILD_PLAN.md:114 ("`import_batches` — … status, undo-able") and :210 ("Import batch summary and undo"), reviewer: Claude. By the time a family undoes an import, its rows may be confirmed, split, paired as transfers, matched to receipts, linked as refunds, and posted to the ma'aser and reserve ledgers. The plan does not say what undo does to any of these, and has no deletion rule for financial rows, which conflicts with rule 9 ("Nothing is silently overwritten").
Plan baseline: batches are undo-able; semantics unstated; no soft-delete rule.
Runtime evidence: no code yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 deletion and undo | unstated | soft delete for all financial rows; undo always allowed, with a warning listing affected confirmed/edited rows, and cleans up links | soft delete; undo allowed only while no row in the batch has been confirmed, edited, paired or matched |
| R2 jobs | approved A | ledger rebuild runs as a job | ledger rebuild runs as a job |
| R6+ remedies | pending | pending | pending |
Question D9:
D9 — What happens when a family undoes an import?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 5/9.
ELI10: Say a family imports the wrong file, answers a few questions about it, attaches a receipt, then notices and presses Undo. The plan says imports can be undone but not what happens to those answers, the receipt, a transfer paired with another account, or the ma'aser already worked out. Either undo always works and tidies everything up, after showing what will be lost, or undo is only offered until anyone has touched the batch.
Stakes if we pick wrong: undo leaves orphaned receipts, half-pairs and wrong ma'aser owed, or the family is stuck with a bad import.
Recommendation: A because a bad import should always be fixable, and the warning keeps it from being silent.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Always undoable, with cleanup (recommended)
  ✅ A wrong import can always be reversed, even weeks later
  ✅ Every link is cleaned up the same way and audited once at batch level
  ❌ More cleanup paths to build and test (receipts, pairs, refunds, ledgers)
B) Undo only while untouched
  ✅ Very little cleanup logic; nothing confirmed is ever lost
  ❌ After one answer the family must delete bad rows one by one
Net: more cleanup code in exchange for an undo that always works. (human: ~2 days / CC: ~40 min for A)
Header: Import undo
Options:
A) Always undoable (recommended)
Financial rows are never hard-deleted (`deleted_at`). Undo soft-deletes the batch's transactions after a warning listing how many were confirmed or edited. It returns attached receipts to unmatched, closes their open questions, unpairs transfers (the surviving side becomes an unpaired transfer), unlinks refunds (the refund gets a question), and rebuilds ma'aser and reserve auto-entries. Rules created from answers stay. One audit entry for the batch.
B) Only while untouched
Same soft delete, but Undo is disabled once any row in the batch is confirmed, edited, paired, matched or linked; after that, rows are deleted one at a time.

State: approved
Actual answer: A) Always undoable (D9, user answer)
Accepted scope: financial rows never hard-deleted (`deleted_at`); undo always allowed after a warning listing confirmed/edited counts; undo soft-deletes the batch's transactions, returns receipts to unmatched, closes their open questions, unpairs transfers (survivor becomes an unpaired transfer), unlinks refunds (refund gets a question), rebuilds ma'aser and reserve automatic entries; rules from answers stay; one batch-level audit entry.
History: none

### R6: Pending vs booked transactions
Finding: A5, P2, confidence 6/10 (medium confidence, verify this is actually an issue), BUILD_PLAN.md:84 ("status (auto, confirmed, unconfirmed)"), reviewer: Claude. Open Banking (Phase 14) returns pending card payments that later post with a different date or amount, or vanish. The `status` column describes categorisation, not booking. Without a booking state, a pending row and its booked replacement count twice. CSV exports are normally booked only, so this matters from Phase 14.
Plan baseline: no booking state.
Runtime evidence: no code yet; Open Banking provider not chosen.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 booking state | none | add `booking_status` (pending, booked) in Phase 1; CSV rows always booked; pending rows shown but kept out of totals and ledgers; replacement rule designed in Phase 14 | add it in Phase 14 by migration |
| R5 undo | approved A | unchanged | unchanged |
| R7+ remedies | pending | pending | pending |
Question D10:
D10 — Add a pending/booked flag now, or when Open Banking arrives?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 5.
ELI10: Banks show card payments as "pending" for a day or two before they settle, sometimes for a different amount. CSV files usually contain only settled payments, so this matters once Open Banking is added in the last phase. One extra column now means every report and total is written to ignore pending rows from day one, instead of finding and changing them all later.
Stakes if we pick wrong: in Phase 14, a pending payment and its settled version both count, doubling spending until every query is patched.
Recommendation: A because one column now is cheaper than auditing every total later.
Completeness: A=8/10, B=6/10
Pros / cons:
A) Add the flag now (recommended)
  ✅ Every total, report and ledger excludes pending rows from the start, so Phase 14 adds no rework
  ✅ One column, always "booked" for CSV, so almost no cost until it is used
  ❌ A column that does nothing for the first thirteen phases
B) Add it in Phase 14
  ✅ The early data model stays slightly smaller and only models what CSV provides
  ❌ Every total and query must be found and amended when Open Banking lands
Net: one idle column now vs a cross-cutting change later. (human: ~1h / CC: ~5 min for A)
Header: Pending rows
Options:
A) Add the flag now (recommended)
Add `booking_status` (pending, booked) to `transactions` in Phase 1. CSV and manual rows are booked. Pending rows show in Activity but are excluded from balances, totals, reports and the ma'aser and reserve ledgers. How a booked row replaces its pending one is designed in Phase 14.
B) Add in Phase 14
No booking state until Open Banking; add it by migration then.

State: approved
Actual answer: A) Add the flag now (D10, user answer)
Accepted scope: `booking_status` (pending, booked) on `transactions` from Phase 1; CSV and manual rows booked; pending rows shown in Activity but excluded from balances, totals, reports and ledgers; pending→booked replacement designed in Phase 14.
History: none

### R7: Splits always stored
Finding: Q1, P1, confidence 9/10, BUILD_PLAN.md:85 ("a transaction without explicit splits has one implicit split"), reviewer: Claude. An implicit split means every total, report, filter and ma'aser calculation must handle two shapes: rows with split records and rows without. Each query that forgets the second shape silently drops spending. Rule 5 ("splits must balance") can only be enforced on stored rows.
Plan baseline: implicit split when none is stored.
Runtime evidence: no code yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 split storage | implicit single split | every transaction has ≥1 stored split; category lives only on splits; split sum checked on every write | implicit split as written |
| R6 booking state | approved A | unchanged | unchanged |
| R8+ remedies | pending | pending | pending |
Question D11:
D11 — Store at least one split for every transaction?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 5 (data model).
ELI10: A £100 supermarket shop can be split into £70 Groceries and £30 Clothing. The plan stores split lines only when a payment is split, and treats every other payment as one invisible split. That means every report needs two code paths, and any one that forgets the invisible case quietly loses spending. Storing one split line for every payment means one shape everywhere, and the "splits add up" rule can be checked on every save.
Stakes if we pick wrong: category totals and ma'aser silently miss transactions wherever a query handles only one shape.
Recommendation: A because one shape removes a whole class of silent total errors.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Always store splits (recommended)
  ✅ Every total, filter and report reads categories one way, from split lines
  ✅ The "splits sum to the amount" rule is enforced on every write, with tests
  ❌ One extra row per transaction (roughly doubles row count; trivial at family scale)
B) Implicit split
  ✅ Fewer rows; unsplit payments carry their category directly
  ❌ Two shapes to handle in every query; a missed case silently drops spending
Net: one extra row per payment for one consistent shape. (human: ~2h / CC: ~10 min)
Header: Splits
Options:
A) Always store splits (recommended)
Every transaction has at least one stored split. Category (nullable while uncategorised) lives only on splits, never on the transaction. One write helper creates or replaces splits and rejects any set that does not sum exactly to the transaction amount. Recategorising an unsplit payment updates its single split.
B) Implicit split
Keep the plan as written: split rows only when a payment is split.

State: approved
Actual answer: B) Implicit split (D11, user answer)
Accepted scope: split rows only when a payment is split. Necessary implementation of B (no new choice): `transactions` gains `category_id`, used when no split rows exist (the plan's transactions table has no category today, BUILD_PLAN.md:84); all totals read categories through one shared helper that returns either the stored splits or the single implicit split; when split rows exist they must sum exactly to the amount.
History: none

### R8: Balance anchor and bank balance checkpoints
Finding: Q2, P1, confidence 8/10, BUILD_PLAN.md:83 ("`accounts` — … opening balance, is_liquid, include_in_net_worth"), reviewer: Claude. Available cash (rule 6) and net worth are built from account balances. An opening balance with no date cannot anchor a CSV that starts mid-history, and with no check against the balance the bank reports, a missing or duplicated row shifts every figure on Home with nothing to flag it. Most UK bank CSVs include a running balance column.
Plan baseline: undated opening balance; no reconciliation.
Runtime evidence: no code yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R8 balance basis | undated opening balance | opening balance with an "as at" date; balance = opening + booked transactions after it; bank-reported balances stored as checkpoints; drift flagged on Home and the account | dated opening balance only, no checkpoints |
| R7 splits | approved B | unchanged | unchanged |
| R9+ remedies | pending | pending | pending |
Question D12:
D12 — Check our balances against the bank's own figures?
Project/branch/task: FFCC, claude/lucid-goldberg-gjcsva, eng review of BUILD_PLAN.md section 5 (data model).
ELI10: Available cash starts from each account's balance. The app works it out as opening balance plus every transaction since. If one row is missing from a CSV, or imported twice, every figure on Home is wrong and nothing says so. Most bank CSVs include the bank's own running balance, and statements show a closing balance. Saving those as checkpoints lets the app say "we're £23.40 off on the current account since 3 March" instead of being quietly wrong.
Stakes if we pick wrong: Home shows a confident but wrong available cash, and the family loses trust in every number.
Recommendation: A because it turns silent balance errors into a visible, fixable flag.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Dated opening + checkpoints (recommended)
  ✅ Missing or doubled rows show up as a flagged difference on the exact account and date
  ✅ Uses the running balance most bank CSVs already include, at no extra effort for families
  ❌ One more table (`balance_checkpoints`) and a drift check to build and test
B) Dated opening balance only
  ✅ Simpler; balance is just opening plus transactions
  ❌ Import gaps and duplicates go unnoticed until someone compares with the bank by hand
Net: one small table for numbers the family can trust. (human: ~1 day / CC: ~20 min for A)
Header: Balances
Options:
A) Dated opening + checkpoints (recommended)
`accounts.opening_balance` gets `opening_balance_date`. Balance on any date = opening + booked transactions after that date. New table `balance_checkpoints` (account, date, bank-reported balance, source: csv running balance, statement, manual). When our computed balance differs from a checkpoint, the account and Home show the difference and the date it started. Import maps the running-balance column where a bank provides one.
B) Dated opening only
Add `opening_balance_date`; no checkpoints or drift check.

State: approved
Actual answer: A) Dated opening + checkpoints, auto-decided (recommended option) under the user's later instruction "option 2: apply your recommendation on everything; everything is changeable later"
Accepted scope: `opening_balance_date`; balance = opening + booked transactions after it; `balance_checkpoints` table; drift shown on the account and on Home; import maps the running-balance column where present.
History: D12 first answered "skip" (pending); then resolved by the option 2 authorisation.

### R9–R24: decided under the user's option 2 authorisation
The user found one question per finding too slow and chose "option 2: apply your recommendation on everything; everything is changeable later". Each row below is the recommended option, applied to sections 4 and 5. **Each is open to veto.** No brief was sent for these, so there is no D-number.

| ID | Finding (severity, confidence, line) | Decision applied | Where in plan |
|---|---|---|---|
| R9 | Q3 P1 9/10 :209 date+amount+description dedupe drops genuine identical rows | Occurrence numbers in the dedupe key, unique DB index, external id first; cross-source near matches (±3 days) become "duplicate?" questions | Rule 10, `transactions`, Phase 2 |
| R10 | Q4 P1 8/10 :62/:84/:86 transfer state stored twice; no rule for a missing side | Transfer = category kind `transfer`; pair shares `transfer_group_id`, different accounts, sums to zero; unpaired transfers excluded from totals, question after 10 days; mortgage payments never paired | Rule 3 |
| R11 | Q5 P1 7/10 :62 transfers to own accounts we don't import | Pair with a manual account (`is_manual`); the other side is posted automatically with source `system` | Rule 3, `accounts` |
| R12 | Q6a P1 8/10 :66 ma'aser basis unstated | Net amount received, per income category with `maaser_effect = accrue`; gross givers use manual adjustments | Rule 7 |
| R13 | Q6b P1 8/10 :108 settings not dated | `maaser_settings.effective_from`; changes apply forward only | Rule 7, `maaser_settings` |
| R14 | Q6c P2 7/10 :66 overpayment | Carries forward: owed may go below zero, shown as "ahead by £x" | Rule 7 |
| R15 | Q6d P1 8/10 :109 ledger goes stale when a payment is recategorised | Automatic ledger rows (ma'aser and reserves) are a projection rebuilt by a job when the source changes; manual rows untouched | Rule 13, Planning tables |
| R16 | Q7 P2 8/10 :86 `counts_for_maaser` means different things for income and charity; charity is its own kind | `maaser_effect` (accrue, reduce, none); charity is an expense category | `categories` |
| R17 | Q8 P1 8/10 :67 "unexplained reduction" undefined, since the app can't see the purse | Sweep all unnoted cash monthly into one system transaction; optional cash-on-hand count sweeps only the difference; late notes recalculate the sweep | Rule 8, workflow 6 |
| R18 | Q9 P2 9/10 :92 rule action "tag" conflicts with CLAUDE.md ("never infer or auto-suggest") | Removed: rules never apply tags, events or people | `rules` |
| R19 | Q10 P2 7/10 :115 audit mechanics | Entity-level before/after JSON, same DB transaction as the change, one entry per import batch, append-only | Rule 9, `audit_log` |
| R20 | Q11 P2 7/10 :63 refund edge cases (partial, split purchase, no original) | Copy the original's category (pro-rata if split); partial allowed; total ≤ original or question; unmatched refund → best guess + question | Rule 4 |
| R21 | Q12 P2 7/10 :106-107 no link between spending and a reserve | `reserve_id` on transaction/split auto-releases; available cash may go negative, with a calm warning on Home | Rule 6, tables |
| R22 | Q13 P2 6/10 :78 dates, time zone and financial year | Booking date as `YYYY-MM-DD` UK local; months from the date string; financial year configurable per household, default 6 April | Rule "Dates", `households` |
| R23 | Q14 P2 7/10 :66/:106 rounding of percentages | One rounding helper: per posting, half away from zero, whole pence | Rule 1 |
| R24 | Q15 P2 6/10 :95 questions tied only to a transaction, but onboarding asks per merchant | Subject = transaction, household merchant or transfer pair; one open question per subject; a merchant answer confirms all its unconfirmed rows | `questions` |

Approved user decisions carried into the plan as necessary implementation (no new choice): mortgage and loan payments are expenses and are never transfer-paired, and loan/mortgage accounts hold no transactions (section 2, rule 3, `accounts`); refunds count in the month received (rule 4); available cash formula (rule 6).

## Section 3 — Test review

Framework: none installed yet (no `package.json`); CLAUDE.md names Vitest for engine and money logic, and gstack /qa for pages. Nothing is built, so every path below is a GAP by definition. The list is the required proof for the approved behaviour; it is not optional depth.

```
CODE PATHS (planned)                                   USER FLOWS (planned)
[+] money/ (rounding, signs, format)                   [+] Onboarding import (Phase 2/9)
  ├── [GAP] round half away from zero, per posting       ├── [GAP] [→E2E] upload → map → preview → confirm → result
  └── [GAP] £ formatting only at display                 ├── [GAP] [→E2E] leave mid-sort, come back, progress resumes
[+] import/ dedupe                                       └── [GAP] [→E2E] undo after answering questions
  ├── [GAP] same file twice → 0 new                    [+] Correction (Phase 4)
  ├── [GAP] two identical same-day rows → both kept      └── [GAP] [→E2E] change category → "always?" → rule applies to next import
  ├── [GAP] overlapping files, 3 bank formats          [+] Home figures (Phase 5)
  └── [GAP] cross-source near match → question           └── [GAP] [→E2E] available cash reconciles with Activity + Plan
[+] engine/ splits, transfers, refunds                 [+] Error states
  ├── [GAP] split lines ≠ amount → rejected              ├── [GAP] AI down → rows unconfirmed, sorting resumes later
  ├── [GAP] implicit vs stored splits → same totals      ├── [GAP] worker stopped → Home says sorting is paused
  ├── [GAP] pair sums to zero; unpaired excluded         └── [GAP] balance drift → shown on account and Home
  ├── [GAP] mortgage payment never paired
  ├── [GAP] refund pro-rata over split purchase; > original → question
  └── [GAP] refund counted in month received
[+] ledgers/ ma'aser + reserves
  ├── [GAP] accrue on net income; reduce on charity; owed < 0 allowed
  ├── [GAP] effective_from: change does not rewrite history
  ├── [GAP] recategorise income → rebuild corrects owed; manual rows kept
  └── [GAP] reserve release via reserve_id; available cash negative
[+] cash/ month-end sweep (+ count, + late note)
[+] import/undo cleanup (receipts, pairs, refunds, ledgers)
[+] db/ household scoping: no query returns another household's rows
[+] ai/ payload redaction                [→EVAL] categorisation prompt quality on seed + fixtures

COVERAGE: 0/32 paths tested (nothing built yet) | GAPS: 32 (7 E2E, 1 eval)
```

Findings:
- `[P2] (confidence: 8/10) BUILD_PLAN.md:62-75` (rules 3, 5, 10, 13): invariants such as "splits sum to amount", "pairs sum to zero" and "re-import adds nothing" are best proven over generated inputs, not three hand-picked examples. **R28 (auto-decided, option 2):** use property-based tests (fast-check, a Vitest-compatible dev dependency) for splits, transfer pairs, dedupe idempotence, rounding and ledger rebuild = incremental result.
- `[P2] (confidence: 7/10) CLAUDE.md "every query is scoped by it"`: there is no test requirement that proves household scoping. **Required proof (approved house rule):** a two-household fixture; every repository function is checked to return only its own household's rows.

Test plan artifact: `/root/.gstack/projects/ymf6161-FFCC/root-claude-lucid-goldberg-gjcsva-eng-review-test-plan-20261016.md` (local to this session's gstack state; key content repeated above).

Dispositions: R28 accepted (auto-decided, veto open); household scoping test accepted as required proof.

## Section 4 — Performance review

Scale (estimated): one family ≈ 3–6 accounts × 1–3k transactions a year; onboarding imports up to ~20k rows. Unknown: community scale.
- `[P2] (confidence: 7/10) BUILD_PLAN.md:84` no indexes stated. **R25 (auto):** indexes on (household_id, date), (account_id, date), transfer_group_id, refund_of_id, questions(household_id, status), jobs(status, run_after), plus the dedupe unique index.
- `[P2] (confidence: 8/10) BUILD_PLAN.md:158` AI per transaction during onboarding would be ~20k calls. **R26 (auto):** categorise per unique normalised merchant (typically a few hundred per household), batched, with results reused by every row; rules and cached merchants are checked before any AI call.
- `[P3] (confidence: 6/10) rule 13` (medium confidence, verify this is actually an issue): rebuilding ledgers from full history on every edit is fine at family scale but wasteful. **R27 (auto):** rebuild for the affected household from the changed date forward.
- Balances computed by SUM over indexed rows: fine at family scale; no cache until measured.

## Outside voice

Codex CLI not installed (`CODEX_MODE: not_installed`); the native fallback needs TaskOutput, which this session does not have. Outside voice unavailable; no independent second opinion this run. Recorded as missing coverage, not a clean review.

## TODOs

No TODOS.md exists. Deferred items are tracked in section 11 (Open questions) rather than a new file (auto-decided under option 2).

## Failure modes

| Path | Realistic failure | Handling | User sees |
|---|---|---|---|
| Import | Bank changes CSV format | Zod row validation; batch error count; profile re-mapping | Clear error count and the bad rows |
| Dedupe | Same payment from CSV and Open Banking with different text | Near-match question | "Is this a duplicate?" |
| Categorise | AI provider down or invalid output | Zod-validated; rows stay unconfirmed; job retries | Unconfirmed flag; nothing lost |
| Worker | Worker process not running | **Critical gap, resolved by R29 (auto):** Home shows "sorting paused" when the oldest pending job is over 10 minutes old | Calm notice instead of a silent stall |
| SQLite | Two writers collide | WAL + busy timeout + short transactions; job retry | Nothing |
| Balances | Missing CSV rows | Checkpoint drift | Difference shown with its start date |
| Ledgers | Recategorised income | Rebuild job | Ma'aser owed corrects itself |
| Undo | Undo after confirmations | Warning + cleanup | Counts before confirming |

## NOT in scope (this review)

- Feature cuts: none; full scope stays (binding).
- Structure changes from D4: declined (Original arrangement kept).
- Pending→booked replacement logic: designed in Phase 14 (R6).
- Tax reserve method, community vs single family, AI threshold, digest size, data retention: product questions left open in section 11.
- Postgres migration mechanics: later phase; guardrails only now (R1).

## What already exists

Nothing in code: the repository holds docs and the vendored gstack only. Reuse targets: Drizzle `onConflict` for idempotent upserts, a database table as the job queue (standard pattern), Zod for every boundary, and fast-check for invariants. No shared-code extraction proposed (no callers exist yet).

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| Foundation (schema, db, audit, jobs, worker) | db/, jobs/, audit/ | — |
| Money helpers + rounding | money/ | — |
| CSV import + dedupe + undo | import/ | Foundation, money |
| AI module + redaction + mock | ai/ | — |
| Engine (rules, transfers, refunds, ledgers) | engine/ | Foundation, money |
| Screens | app/ | Foundation |

Lane A: Foundation → Import → Engine (shared db/). Lane B: money/ + ai/ (independent). Lane C: app shell after Foundation. Launch A + B; start C after Foundation merges. Conflict flag: db/schema is shared by every lane, so schema changes go through Lane A only.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1 day / CC: ~30 min)** — db — Schema per section 5 with portability rules, WAL, indexes (R1, R25)
  - Surfaced by: Scope Challenge S1; Performance R25
  - Files: db/, drizzle migrations
  - Verify: `bun run setup` on a clean machine; migration applies
- [ ] **T2 (P1, human: ~1 day / CC: ~30 min)** — jobs — `jobs` table, worker, retry/backoff, "sorting paused" signal (R2, R29)
  - Surfaced by: Architecture A1; Failure modes
  - Files: jobs/, worker entry
  - Verify: kill worker mid-job, restart, job completes once
- [ ] **T3 (P1, human: ~4h / CC: ~15 min)** — audit — Audit helper writing in the same transaction; batch entries (R19)
  - Surfaced by: Code quality Q10
  - Files: audit/
  - Verify: Vitest: failed write leaves no audit row and vice versa
- [ ] **T4 (P1, human: ~1 day / CC: ~30 min)** — import — Dedupe with occurrences, unique index, near-match questions, checkpoints (R9, R8)
  - Surfaced by: Q3, Q2
  - Files: import/
  - Verify: fixtures with identical rows and overlapping files; property test re-import = 0 new
- [ ] **T5 (P1, human: ~2 days / CC: ~40 min)** — import — Undo with cleanup (R5)
  - Surfaced by: Architecture A4
  - Files: import/, engine/
  - Verify: undo after answers, receipts, pairs; no orphans; ledgers equal pre-import
- [ ] **T6 (P1, human: ~2 days / CC: ~1h)** — engine — Splits helper (implicit + stored), transfers incl. unpaired/manual accounts, refunds (R7, R10, R11, R20)
  - Surfaced by: Q1, Q4, Q5, Q11
  - Files: engine/
  - Verify: property tests for split sums and pair sums; refund month and pro-rata tests
- [ ] **T7 (P1, human: ~2 days / CC: ~1h)** — ledgers — Ma'aser and reserve projection, dated settings, carry-forward, reserve release (R12–R15, R21, R27)
  - Surfaced by: Q6a–d, Q12
  - Files: engine/ledgers
  - Verify: rebuild-from-date equals full rebuild; recategorisation corrects owed
- [ ] **T8 (P2, human: ~4h / CC: ~15 min)** — ai — Payload builder with redaction; per-merchant batching (R4, R26)
  - Surfaced by: A3; Performance R26
  - Files: ai/
  - Verify: redaction unit tests; call count per import = unique merchants
- [ ] **T9 (P2, human: ~4h / CC: ~15 min)** — merchants — Shared table write guard: web-lookup businesses only (R3)
  - Surfaced by: A2
  - Files: engine/merchants
  - Verify: transfer to a person never creates a shared row
- [ ] **T10 (P2, human: ~4h / CC: ~15 min)** — cash — Month-end sweep with count and late-note recalculation (R17)
  - Surfaced by: Q8
  - Files: engine/cash
  - Verify: Vitest scenarios for no notes, count, late note
- [ ] **T11 (P2, human: ~2h / CC: ~10 min)** — tests — Two-household scoping fixture and checks; fast-check setup (R28)
  - Surfaced by: Test review
  - Files: test helpers
  - Verify: scoping test fails if a query drops the household filter

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 8/8 applicable rows emitted (PLAN_REALITY: phase=eng rows=7/7 tier-1 + 1 tier-2, verdict=complete), 1 unverified premise (SQLite job-queue behaviour under two writers)
- Architecture Review: 5 issues found
- Code Quality Review: 15 issues found
- Test Review: diagram produced, 32 gaps identified (nothing built), 2 findings
- Performance Review: 3 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (deferred items kept in section 11)
- Failure modes: 1 critical gap flagged (worker stall, resolved by R29)
- Unresolved decisions: 0 in this review (R8–R29 auto-decided under the user's option 2; veto open)
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 3 lanes, 2 parallel / 1 sequential
- Lake Score: 0/8 (only D11 offered a 10/10 option, and the user chose B)

REALITY: premise-table finding "ORM keeps the switch to Postgres small" false; other premises are product targets [estimated] BUILD_PLAN.md:32
REALITY: already-done pass git log origin/claude/lucid-goldberg-gjcsva shows docs and gstack only; no plan item built yet (commit 5d70114)
REALITY: surface-check finding `bun run setup` and `bun run worker` are proposed, not yet defined (no package.json) BUILD_PLAN.md:204
REALITY: binding-decisions pass 4 user decisions logged and carried into sections 2-4 BUILD_PLAN.md:25
REALITY: numbers pass "under a minute" [estimated] BUILD_PLAN.md:19; "~5 questions" [estimated] BUILD_PLAN.md:212; "top 80%" [estimated] BUILD_PLAN.md:176; "6–12 months" [estimated] BUILD_PLAN.md:172
REALITY: deferred-asks pass every brief feature stays in scope; open product questions listed in section 11 BUILD_PLAN.md:21
REALITY: pr-count pass no .gstack/ship-policy.json; default one PR per phase BUILD_PLAN.md:203
REALITY: transaction-semantics finding two writers on SQLite need WAL + busy timeout + short transactions (R2) BUILD_PLAN.md:44

## Decision ledger — approval readiness
Approval readiness: PASS — R1 (D5), R2 (D6), R3 (D7), R4 (D8), R5 (D9), R6 (D10), R7 (D11), R8 (D12 skip, then option 2), R9–R29 (option 2 authorisation, user message "option 2. everything is changeable later if i dont like it").

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed; native fallback lacks TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 25 issues, 1 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed; no native fallback possible). No outside findings.
- **VERDICT:** no reviews CLEAR. Eng review ran in full; all 25 issues and the 1 critical gap have decided remedies written into sections 2–5, 8 and 9 (R8–R29 auto-decided under the user's authorisation, veto open). Status stays ISSUES OPEN until the remedies are built. eng review required.

NO UNRESOLVED DECISIONS
