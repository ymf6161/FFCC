# FFCC — House rules for Claude Code

FFCC (Family Financial Control Centre) is a family finance app that keeps the books itself and only asks the family when it isn't sure.

## Read first, every session
- `docs/BUILD_PLAN.md` — scope, data model, phases, decisions. The source of truth.
- `docs/DESIGN.md` — design system. Every screen follows it.
- If a decision changes during a session, update `docs/BUILD_PLAN.md` in the same commit.

## Stack
- Next.js (App Router) + TypeScript, run with Bun
- Tailwind CSS + shadcn/ui
- Drizzle ORM, SQLite locally (Postgres later) — never write database-specific SQL that would block the switch
- Zod at every boundary
- Vitest for engine and money logic

## Money rules (never break these)
1. Money is integer pence. No floats anywhere. Format to £ only at display.
2. Money in is positive, money out is negative.
3. Transfers between own accounts and credit card repayments are never income or spending.
4. Refunds are linked to the original purchase and reduce that expense; never income.
5. Split lines always sum exactly to the transaction amount.
6. Reserves are virtual allocations, not accounts. Available cash = liquid balances − reserves − ma'aser owed.
7. Every write to financial data goes through the audit log helper.
8. Imports are idempotent: the same data imported twice creates nothing new.
9. Any change to money logic needs tests first or alongside.

## Architecture rules
- Every household-owned table has `household_id`; every query is scoped by it.
- CSV and Open Banking feed the same import pipeline. Nothing downstream knows the source.
- All AI calls go through the `ai` module, with a mock provider for tests and offline work. Validate AI output with Zod; never trust it raw.
- All outbound messages go through the `channels` module. In dev, messages go to the console and in-app inbox, never to real phones.
- Tags, events and people are entered by the user only. Never infer or auto-suggest them.

## Data and privacy
- Never commit real bank data, names or account numbers. Fixtures are fake or anonymised.
- Never log full transaction descriptions or account numbers in production logs.
- The SQLite database file is not committed. `bun run setup` rebuilds it from migrations and the seed.

## Working style
- One feature per session, following the current phase in the build plan.
- After building: /review, /qa (screens), /design-review (screens), then /ship.
- Use plain British English in the UI. Calm, clear, modest wording.
