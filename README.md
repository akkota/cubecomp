# CubeComp

Rubik's Cube Competition Platform built with Next.js, Supabase, and shadcn/ui.

## Getting Started

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create an account / project
2. From your project dashboard, go to **SQL Editor**
3. Paste and run the contents of `supabase/migrations/001_initial_schema.sql`
4. Go to **Project Settings > API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Fill in your Supabase URL and anon key in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

### 3. Run the App

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **User accounts** via Supabase Auth (email/password)
- **Create competitions** with any of the 17 official WCA events
- **Multi-round events** with configurable cutoffs
- **Server-side scramble generation** using `cubing.js`
- **Self-report and judge time entry** modes
- **Live leaderboards** per event/round
- **Row Level Security** on all database tables

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Auth + DB:** Supabase
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Scramble Gen:** cubing.js (server-side)
- **Validation:** Zod + React Hook Form

## Project Structure

```
src/
  app/
    (auth)/         # Login, signup, auth callback
    dashboard/      # User dashboard
    competitions/   # Competition CRUD, leaderboards
  components/
    auth/           # Auth form components
    competitions/   # Competition-related components
  lib/
    supabase/       # Supabase client (server + browser)
    scramble.ts     # Scramble generation
    results.ts      # Result calculation (averages, rankings)
    wca-events.ts   # WCA event definitions
  types/
    database.ts     # TypeScript types for DB schema
```
