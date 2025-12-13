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

**Prereqs**: Node 22.x, Supabase project, git.

**Setup**
1. `npm install`
2. Configure `.env.local` (see README for template).
3. Apply migrations `001`–`008` (users, verification codes, class days, entries, auth refactor, classrooms, assignments, legacy cleanup) via Supabase dashboard or `supabase db push`.
4. `npm run dev` and open http://localhost:3000
5. Optional: `npm run seed`
   - To seed against a specific env file: `ENV_FILE=.env.staging.local npm run seed:fresh`

Email sending is mocked (`ENABLE_MOCK_EMAIL=true` logs codes). Wire a provider in `src/lib/email.ts` for production.

---

## Development Commands

```bash
npm run dev           # dev server
npm run build         # production build
npm start             # run production build locally
npm run test          # all tests
npm run test:watch    # TDD loop
npm run test:coverage # coverage report
npm run lint          # ESLint
npm run type-check    # TypeScript
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
- `CRON_SECRET` (required for protected cron endpoints; Vercel sends `Authorization: Bearer <CRON_SECRET>`)

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

---

## Troubleshooting

- **Server won’t start**: check Node 22.x, `.env.local`, clear `.next`.
- **Supabase issues**: verify keys, ensure migrations applied, review RLS if access errors.
- **Emails not arriving**: ensure mock mode expected; otherwise implement provider in `email.ts`.
- **Timezone/attendance**: ensure server runs with America/Toronto assumptions; tests cover DST via `date-fns-tz`.

---

For architecture, see `docs/core/architecture.md`. For testing, see `docs/core/tests.md`. For UI, see `docs/core/design.md`.
