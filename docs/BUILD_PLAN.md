# FFCC — Build Plan

Family Financial Control Centre. Version 1 of the build plan, 16 Oct 2026.

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
| Database | Local SQLite + migrations + seed script while building; hosted Postgres when data needs to persist | Works on any machine in seconds; ORM keeps the switch to Postgres small. |
| Users | One login per household for now; data model supports multiple members and roles from day one | Family logins come later without a migration rewrite. |
| Onboarding | Pausable at every step, progress saved per household | Families stop and start; anyone in the household can resume. |
| Channels | In-app first, then email and SMS as the backbone, WhatsApp optional | Some users have no WhatsApp. |
| Tags, events, people | Entered by the user only; never inferred | Agreed with client. |
| Build tool | Claude Code with gstack | Real codebase, testable money logic. |

---

## 3. Proposed tech stack (for /plan-eng-review to challenge)

- **Framework:** Next.js (App Router) + TypeScript, run with Bun
- **UI:** Tailwind CSS + shadcn/ui, following `docs/DESIGN.md`
- **Database:** SQLite via Drizzle ORM; Postgres later (Neon or Supabase)
- **Validation:** Zod at every boundary (CSV rows, AI output, form input, message replies)
- **AI:** Claude API for categorisation, merchant lookup, receipt reading and cash-note parsing, behind one `ai` module with a mock provider for tests and offline work
- **Messaging:** a `channels` module with providers for in-app, email and SMS/WhatsApp. Dev uses a console/in-app provider; real providers (e.g. Resend/Postmark for email, Twilio for SMS/WhatsApp) added in Phase 10
- **Files:** local disk in dev, object storage later (receipts, voice notes)
- **Background work:** a simple job runner for imports, categorisation and digests; upgrade only if needed
- **Testing:** Vitest for the engine and money logic; gstack /qa for pages
- **Auth:** simple single-household login or dev bypass in Phase 1; real auth before any real data

---

## 4. Accounting rules (non-negotiable)

These must hold everywhere: engine, reports, dashboard, exports. Each one gets automated tests.

1. **Money is integer pence.** Never floats. Format to £ only at display.
2. **Signed amounts.** Money in is positive, money out is negative, from the account's point of view.
3. **Transfers are never income or spending.** Moves between the household's own accounts and credit card repayments are linked as a transfer pair and excluded from income and expense totals.
4. **Refunds reduce the original expense.** A refund is linked to its purchase and nets against that category; it is never income.
5. **Splits must balance.** The split lines of a transaction always sum exactly to the transaction amount.
6. **Reserves are virtual.** They are allocations on top of real accounts, not accounts. **Available cash = liquid account balances − total allocated to reserves (including ma'aser owed).**
7. **Ma'aser accrues automatically.** Qualifying income increases ma'aser owed by the household's percentage; qualifying charity payments reduce it. Rules are configurable (see Open questions).
8. **Cash is tracked as a wallet account.** A withdrawal is a transfer from bank to cash wallet. Cash notes create expenses from the wallet. At month end, any unexplained wallet balance reduction becomes "General cash spending".
9. **Nothing is silently overwritten.** Every user or system edit to financial data writes an audit log entry (before, after, who, when, why).
10. **Imports are idempotent.** Importing the same data twice, from CSV or Open Banking, never creates duplicates.

---

## 5. Data model (first draft)

Every household-owned table carries `household_id`. All money columns are integer pence.

**People and access**
- `households` — name, currency (GBP), financial year start, onboarding progress
- `users` — login identity
- `household_members` — user ↔ household, role (owner, member, viewer), notification phone/email

**Money**
- `accounts` — type (current, savings, credit card, cash wallet, loan, mortgage, investment, other asset), name, institution, opening balance, is_liquid, include_in_net_worth
- `transactions` — account, date, amount, raw description, merchant, source (csv, open_banking, manual, cash_note, receipt), external_id, dedupe_hash, import_batch, status (auto, confirmed, unconfirmed), confidence, transfer_group_id, refund_of_id, notes
- `transaction_splits` — transaction, category, amount, note (a transaction without explicit splits has one implicit split)
- `categories` — name, parent, kind (income, expense, transfer, charity), system or custom, counts_for_maaser
- `manual_valuations` — for net worth: asset or liability value at a date (house, pension, car)

**Learning**
- `merchants` — shared across all households: canonical name, match patterns, web lookup result, suggested category, lookup date
- `household_merchants` — household override: merchant ↔ household category, confirmed flag
- `rules` — conditions (merchant, description pattern, amount range, account, direction), actions (category, split template, tag, mark as transfer, ma'aser treatment), priority, origin (onboarding, answer, correction, manual), enabled

**Bookkeeper loop**
- `questions` — transaction, question type (category, transfer, ma'aser, receipt match, duplicate), options, status (open, sent, answered, expired, fallback), answer, answered_by, channel
- `digests` — batch of questions sent together: channel, recipient, sent_at, reply raw text
- `receipts` — file, source (upload, email), parsed merchant/date/total, line items, matched transaction, match confidence
- `cash_notes` — raw text or voice file, transcript, parsed expenses, status

**Optional detail (user-entered)**
- `tags`, `transaction_tags`
- `events` (projects such as a simcha or holiday), `transaction_events`
- `persons` (person tracking), `transaction_persons`

**Planning**
- `reserves` — name, type (tax, emergency, custom), target, funding rule (manual, % of income, fixed monthly)
- `reserve_movements` — ledger of allocations and releases
- `maaser_settings` — percentage, gross or net, which income counts, which payments count
- `maaser_ledger` — accruals from income, payments from charity, manual adjustments, each linked to its source transaction
- `goals` — name, target amount, target date, linked reserve or account, progress method

**Plumbing**
- `bank_profiles` — saved CSV column mapping per bank/format: date column and format, amount or debit/credit columns, sign convention, description columns, header row
- `import_batches` — file, profile, account, row counts (new, duplicate, error), status, undo-able
- `audit_log` — entity, entity id, field, before, after, actor (user or system), reason, timestamp

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

1. **Import** — CSV (or Open Banking) → normalise → dedupe → store → categorise → questions for low confidence.
2. **Categorise** — apply household rules → household merchant mapping → shared merchant suggestion → AI with confidence. Above threshold: status `auto`. Below: create a question; meanwhile store best guess as `unconfirmed`.
3. **Daily digest** — at the household's chosen time, send up to ~5 open questions, ordered by value and age. Replies by number, word or Y/N. Each answer confirms the transaction and creates or strengthens a rule. Unanswered questions expire into fallback (best guess stays, marked unconfirmed).
4. **Correction** — user changes a category in the app → audit entry → offer "always do this for [merchant]?" → rule.
5. **Receipt** — upload or email forward → AI reads merchant, date, total, line items → match to transaction (amount, date window, merchant) → attach; if line items span categories, suggest a split for the user to accept.
6. **Cash** — withdrawal moves money to cash wallet → text or voice note ("40 for the cleaner, 20 taxis") → AI parses into wallet expenses → month end: remainder becomes General cash spending.
7. **Ma'aser** — qualifying income posts an accrual; qualifying charity payment posts a reduction; ambiguous charity payments become a Y/N question.
8. **Reserves** — funding rules allocate on income or monthly; spending against a reserve releases it; available cash updates.
9. **Month end** — cash sweep, monthly summary generated and sent, comparison with previous month.
10. **Catch-up** — user filters a period, bulk-tags events/people, reviews unconfirmed items.
11. **Re-consent** (Open Banking phase) — warn ahead of connection expiry; flag stale accounts on Home.

---

## 9. Build phases

Each phase ends with tests passing, /review, /qa (for anything with a screen), /design-review (for screens) and /ship. Acceptance checks are what "done" means.

**Phase 0 — Setup**
- Repo on GitHub, gstack copied into the project, `CLAUDE.md`, docs folder.
- /plan-eng-review on this plan; save the agreed version here.
- /design-consultation → `docs/DESIGN.md`.
- Done when: plan reviewed and updated, design system written.

**Phase 1 — Foundation**
- Next.js app, Tailwind, shadcn/ui themed from DESIGN.md.
- Drizzle + SQLite, first migrations for the full data model in section 5.
- Seed script: one dummy household, 12 months, current account, savings, credit card, cash wallet; salary, mortgage, utilities, groceries, fuel, subscriptions, charity, card repayments, transfers, a few refunds.
- App shell with the five navigation areas (empty states), dev login.
- Audit log helper used by every write.
- Done when: `bun run setup` builds the DB and seed on any machine; all five areas load on phone and desktop widths.

**Phase 2 — CSV import**
- Import wizard: upload, column mapping, preview first 20 rows, sign convention, confirm.
- Saved bank profiles; auto-detect a known format.
- Duplicate detection against existing transactions (external id, then date + amount + normalised description).
- Import batch summary and undo.
- Done when: importing the same file twice adds nothing; three different bank formats import correctly.

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

- Ma'aser rules: gross or net income; which income counts; what counts as charity; opening balance.
- Tax reserve method: flat percentage or estimate.
- One family or a community product (affects pricing, onboarding, merchant sharing across households).
- Financial year: calendar, April–March, or configurable per household.
- Is ma'aser owed counted inside reserves on the dashboard, or shown separately but still deducted from available cash? (Current plan: separate line, still deducted.)
- AI confidence threshold for auto-filing, and digest size.
- Data retention and security standard before any real data goes in.

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

State: pending
Actual answer: skipped by user (D12: "skip")
Accepted scope: none
History: none
