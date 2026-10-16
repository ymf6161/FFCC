# FFCC — Family Financial Control Centre

A family finance app that keeps the books itself and only asks the family when it isn't sure.

Start with `CLAUDE.md` (house rules), `docs/BUILD_PLAN.md` (scope, data model, phases) and `docs/DESIGN.md` (design system).

## Run it

You need [Bun](https://bun.sh) 1.2 or later.

```sh
bun install
bun run setup     # builds data/ffcc.db from migrations and seeds the demo household
bun run dev       # the app on http://localhost:3000
bun run worker    # background jobs, in a second terminal
```

Open http://localhost:3000 and choose **Continue as the demo household**. The demo household holds 12 months of made-up bank data.

`bun run setup` deletes and rebuilds the local database each time, so it gives the same result on any machine.

## Try importing

1. Sign in, then go to **Settings → Import a CSV** (or **Activity → Import a CSV**).
2. Choose **A new account**, give it a name, and pick a file from `fixtures/csv/`, for example `nationwide-style-joint-2026-01-to-03.csv`.
3. The layout is recognised; check the columns, then the rows, then import.
4. The result page shows the counts and whether our balance matches the bank. **See these transactions** opens them in Activity.
5. Import the overlapping `nationwide-style-joint-2026-02-to-04.csv` into the same account: only the April rows are new. Import either file again: nothing is added.
6. **Undo this import** on the result page removes it again, after asking.

`fixtures/csv/README.md` describes each sample file.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run setup` | Rebuild the local database and seed it |
| `bun run dev` | Start the app in development |
| `bun run worker` | Run background jobs (Ctrl+C to stop) |
| `bun run test` | Vitest: money, audit, jobs, schema, scoping, seed, sessions |
| `bun run typecheck` / `bun run lint` | TypeScript and ESLint |
| `bun run check:screens` | Build, start (on a temporary database), sign in, check every area at 320, 375 and 1280px, and run a CSV import end to end; screenshots in `screenshots/` |
| `bun run db:generate` | Generate a migration after changing `src/db/schema/` |
| `bun run fixtures` | Rewrite the sample CSVs in `fixtures/csv/` from `tests/fixtures/csv-sources.ts` |

## Layout

- `src/db/schema/` — every table (one folder); `src/db/index.ts` is the only place a connection is made
- `src/db/queries/` — household-scoped reads (`householdId` first, always)
- `src/audit/` — every write to household or financial data goes through here
- `src/jobs/`, `src/worker.ts` — the job queue and worker
- `src/money/` — formatting, rounding and parsing of integer pence
- `src/seed/` — the demo household generator
- `src/import/` — CSV parsing, layout detection, dedupe, import, undo and balance checks
- `src/app/` — the five areas: Home, Activity, Plan, Reports, Settings
- `drizzle/` — migrations (committed)

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:data/ffcc.db` | Local SQLite file |
| `SESSION_SECRET` | dev-only default | Required (32+ characters) in production |
| `FFCC_DEV_LOGIN` | off in production | Set to `1` to allow the demo sign-in on a production build |
