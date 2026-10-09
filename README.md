# CubeComp

Online Rubik’s Cube competition platform. Create public or private competitions, run multi-round WCA-format events or head-to-head brackets, generate official-style scrambles, and track results on live leaderboards.

Built with **Next.js**, **Supabase**, and **cubing.js**.

## Features

- **Accounts** — email/password auth via Supabase; **username** is the public identity (email is for sign-in only)
- **Standard competitions** — 17 official WCA events, multi-round formats (Ao5 / Mo3), advancement rules, live leaderboards
- **Head-to-head** — single/double elimination brackets, best-of sets, bye propagation
- **Scrambles** — WCA-compatible generation via `cubing.js`, with official-style 2D state visualizations
- **Privacy** — public or password-protected private competitions
- **Admin tools** — manage rounds, add admins by username, optional video verification
- **Lifecycle gates** — registration and scramble access close when a competition ends
- **Themes** — multiple UI themes

## Tech Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Auth + DB | Supabase (Auth, Postgres, RLS) |
| UI | Tailwind CSS v4 + shadcn/ui |
| Scrambles | cubing.js |
| Validation | Zod + React Hook Form |

## Getting Started

### 1. Prerequisites

- Node.js 22+
- A [Supabase](https://supabase.com) project

### 2. Database

Apply **all** SQL files in `supabase/migrations/` in order (`001` → `024`) via the Supabase SQL Editor, or link the project with the Supabase CLI and push migrations.

If your database already has migrations through `023`, run only [migration 024](supabase/migrations/024_fix_competition_password_search_path.sql) in the SQL Editor of the Supabase project used by your deployed website. It fixes `function gen_salt(unknown) does not exist` during private competition creation and the related `crypt` error during password verification. It preserves existing passwords and privacy protections. Do not reapply `011`, which would replace newer privacy behavior with older function bodies. Deploying to Vercel does not apply this database repair.

Before applying the repair, confirm that `pgcrypto` is installed in `extensions` (the expected Supabase location) or `public`:

```sql
SELECT extnamespace::regnamespace AS extension_schema
FROM pg_extension
WHERE extname = 'pgcrypto';
```

If no row is returned, enable it with `CREATE EXTENSION pgcrypto WITH SCHEMA extensions;`. If another schema is returned, inspect that installation before applying the repair; migration `024` does not relocate extensions.

### 3. Environment

```bash
cp .env.example .env.local
```

From **Project Settings → API**, set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm test` | Run unit / regression tests |
| `npm run lint` | ESLint |

The password database regression tests can also run independently with `node --test tests/private-competitions-db.test.mjs`. They require local PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`, and `psql`) and `pgcrypto`, and must run as a non-root user. They start an isolated temporary database with Unix-socket access only, apply the migrations, and clean up afterward. They never connect to your configured Supabase project and report a skip if the local tools are unavailable.

## Project Structure

```
src/
  app/                 # Routes (auth, dashboard, competitions, profile)
  actions/             # Server actions (registration, scrambles, tournaments, …)
  components/          # UI (auth, competitions, tournament, theme, …)
  hooks/               # Client hooks (e.g. current profile)
  lib/                 # Supabase clients, scrambles, results, status, identity
  types/               # Shared TypeScript types
supabase/
  migrations/          # Ordered Postgres schema, RLS, and RPC migrations
tests/                 # Node test suite
```

## How Identity Works

- **Email** — used only for authentication (login / signup)
- **Username** — public handle everywhere else (navbar, leaderboards, admin invite, brackets)

Admin invite searches by username, not email.

## Competition Types

**Standard** — multi-event, multi-round WCA-style meets with registration, scrambles, timer/manual entry, and advancement.

**Head-to-head** — single-event bracket tournaments (seeded or unseeded) with match sets and solve-by-solve play.

## Deploy

Typical setup: push to the branch connected to **Vercel**, with the same `NEXT_PUBLIC_SUPABASE_*` env vars. Apply migrations to your Supabase project separately (Vercel does not run them for you).

## License

Private project — adjust this section if you publish under an open-source license.
