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
