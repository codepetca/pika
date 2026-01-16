# Project Context

Overview of **Pika**: daily journals, attendance, classrooms, and assignments for online high school courses. Students submit work; teachers track attendance and assignments. America/Toronto timezone is authoritative.

**Status**: Classrooms, assignments, password-based auth, and dashboards are implemented. Working toward full test coverage and polish.

---

## Goals

**Primary**
1) Reliable attendance from daily entries (present/absent)
2) Mobile-friendly journal workflow per classroom
3) Assignments with autosave, submit/unsubmit, and teacher review
4) Teacher dashboards: attendance matrix, roster management, CSV export

**Non-Goals**
- Full LMS (gradebook, forums, announcements)
- Native mobile apps (web-first responsive)
- Real-time collaboration/editor history (future)

---

## Users

- **Students**: join classrooms, submit daily entries, work on assignments, submit/unsubmit.
- **Teachers**: create classrooms, manage rosters/class days, track attendance, create assignments, view submissions.

---

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Supabase** (PostgreSQL + RLS)
- **iron-session** for HTTP-only cookies
- **Tailwind CSS**
- **Vitest + React Testing Library**

---

## Getting Started

## Prerequisites

Node: 24.x (see `package.json#engines` and `.nvmrc`)

Package manager: pnpm (recommended via Corepack; `package.json#packageManager`)

**Setup**
1. Install dependencies:
   - `corepack enable`
   - `pnpm install`
2. Configure `.env.local` (see README for template).
3. Apply all database migrations via Supabase dashboard or `supabase db push`.
4. `pnpm dev` and open http://localhost:3000
5. Optional: `pnpm seed`
   - To wipe + reseed against a specific env file: `ENV_FILE=.env.staging.local ALLOW_DB_WIPE=true pnpm seed:fresh`

Email sending is mocked (`ENABLE_MOCK_EMAIL=true` logs codes). For production email setup, see [`docs/deployment/BREVO-SETUP.md`](../deployment/BREVO-SETUP.md).

---

## Development Commands

```bash
pnpm dev           # dev server
pnpm build         # production build
pnpm start         # run production build locally
pnpm test          # all tests
pnpm run test:watch
pnpm run test:coverage
pnpm run lint
```

---

## Environment Variables (required)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SESSION_SECRET` (>=32 chars for iron-session)
- `DEV_TEACHER_EMAILS` (comma-separated)
- `ENABLE_MOCK_EMAIL` (`true` to log verification/reset codes)
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET` (required for protected cron endpoints; Vercel sends `Authorization: Bearer <CRON_SECRET>`; cron schedules are configured in Vercel dashboard)

Legacy anon/service keys are supported but publishable/secret are preferred.

---

## Feature Overview

1) **Authentication**: Email verification + password. Endpoints for signup, verify-signup, create-password, login, forgot/reset password.

2) **Daily Journal**: Per-classroom entry with Toronto midnight cutoff; present/absent attendance; history view.

3) **Teacher Dashboard**: Attendance matrix, entry drill-down, class days management, CSV export.

4) **Classrooms & Roster**: Create classes, share join code/link, upload roster CSV, manage enrollments.

5) **Assignments**: Create assignments per classroom; students edit with autosave and submit/unsubmit; teachers view stats and read-only docs.

---

## Deployment

- Host on Vercel; configure env vars in dashboard; set `ENABLE_MOCK_EMAIL=false` and add real email provider before production.
- Supabase Cloud for DB; enable connection pooling; run migrations on deploy.
- If using cron, configure schedules in the Vercel dashboard (production recommended). Current recommended schedule: `0 6 * * *` (06:00 UTC).

---

## Roster + Enrollment Rules

- CSV upload populates a **classroom roster allow-list** (no auto-enrollment).
- Students can join only if their signed-in email is on the roster and the classroom has enrollment enabled.
- Teachers can disable enrollment per classroom in Settings.

---

## Troubleshooting

- **Server won’t start**: check Node 24.x, `.env.local`, clear `.next`.
- **pnpm thinks you’re on Node 22**: your `pnpm` binary is being executed by a different `node` than your shell (common when an older global pnpm is earlier in `PATH`). Fix with Corepack:
  - `corepack enable`
  - `corepack prepare pnpm@10.25.0 --activate`
  - Re-open the terminal and re-check: `node -v`, `pnpm -v`, `pnpm exec node -v`
- **Supabase issues**: verify keys, ensure migrations applied, review RLS if access errors.
- **Emails not arriving**: ensure mock mode expected; otherwise implement provider in `email.ts`.
- **Timezone/attendance**: ensure server runs with America/Toronto assumptions; tests cover DST via `date-fns-tz`.

---

For architecture, see `docs/core/architecture.md`. For testing, see `docs/core/tests.md`. For UI, see `docs/core/design.md`.
