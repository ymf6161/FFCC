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

## Scripts

| Script | What it does |
| --- | --- |
| `bun run setup` | Rebuild the local database and seed it |
| `bun run dev` | Start the app in development |
| `bun run worker` | Run background jobs (Ctrl+C to stop) |
| `bun run test` | Vitest: money, audit, jobs, schema, scoping, seed, sessions |
| `bun run typecheck` / `bun run lint` | TypeScript and ESLint |
| `bun run check:screens` | Build, start, sign in, and check all five areas at 320, 375 and 1280px; screenshots in `screenshots/` |
| `bun run db:generate` | Generate a migration after changing `src/db/schema/` |

## Layout

- `src/db/schema/` — every table (one folder); `src/db/index.ts` is the only place a connection is made
- `src/db/queries/` — household-scoped reads (`householdId` first, always)
- `src/audit/` — every write to household or financial data goes through here
- `src/jobs/`, `src/worker.ts` — the job queue and worker
- `src/money/` — formatting, rounding and parsing of integer pence
- `src/seed/` — the demo household generator
- `src/app/` — the five areas: Home, Activity, Plan, Reports, Settings
- `drizzle/` — migrations (committed)

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:data/ffcc.db` | Local SQLite file |
| `SESSION_SECRET` | dev-only default | Required (32+ characters) in production |
| `FFCC_DEV_LOGIN` | off in production | Set to `1` to allow the demo sign-in on a production build |
