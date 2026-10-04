# Project Context

Overview of **Pika**: daily journals, attendance, classrooms, and assignments for online high school courses. Students submit work; teachers track attendance and assignments. America/Toronto timezone is authoritative.

**Status**: Implemented capabilities include classrooms, assignments and editor history, Tests, Gradebook/Student Grades, announcements, attendance, and course authoring. Use [.ai/features.json](../../.ai/features.json) for epic status and [.ai/CURRENT.md](../../.ai/CURRENT.md) for dated rollout evidence.

---

## Goals

**Primary**
1) Reliable attendance from daily entries (present/absent)
2) Mobile-friendly journal workflow per classroom
3) Assignments with autosave, submit/unsubmit, and teacher review
4) Teacher dashboards: attendance matrix, roster management, CSV export

**Non-Goals**
- General-purpose discussion forums
- Native mobile apps (web-first responsive)
- Real-time collaborative editing (assignment history is implemented)

---

## Users

- **Students**: join classrooms, submit daily entries, work on assignments, submit/unsubmit.
- **Teachers**: create classrooms, manage rosters/class days, track attendance, create assignments, view submissions.

---

## Tech Stack

- **Next.js App Router + TypeScript**; exact dependency versions come from `package.json` and `pnpm-lock.yaml` (currently locked Next 15.5.25).
- **Supabase** (PostgreSQL + RLS)
- **iron-session** for HTTP-only cookies
- **Tailwind CSS**
- **Vitest + React Testing Library**

---

## Environment flow

Pika uses local development with local Supabase, local smoke/database checks, a reviewed PR to `main`, then promotion to `production`. The hosted staging database was removed; do not propose recreating it or require a staging/Preview deployment as a gate. See [Workflow](../dev-workflow.md#environments-and-release-flow).

## Getting Started

## Prerequisites

Node: 24.x (`.nvmrc` currently pins the recommended local version)

Package manager: pnpm (recommended via Corepack; `package.json#packageManager`)

**Setup**
1. Install dependencies:
   - `corepack enable`
   - `pnpm install`
2. Set up `.env.local` using the shared-worktree flow in [`docs/dev-workflow.md`](../dev-workflow.md).
   - Maintainer default: symlink the worktree’s `.env.local` to `$HOME/Repos/.env/pika/.env.local`
   - Collaborator default: `cp .env.example .env.local`, then fill in the required values
   - Exception-only: use a branch-specific env file when intentionally isolating backend state
3. Ensure pending migrations have been applied before runtime work that depends on them.
   - Migration application is human-controlled by default. AI requires the one-time, exact target
     and migration authorization defined in
     [`docs/guidance/schema-rollout-checklist.md`](../guidance/schema-rollout-checklist.md); reset,
     repair, rollback, seeding, and cleanup require separate approval.
4. `pnpm dev` and open http://localhost:3000
5. Optional: `pnpm seed`
   - To wipe + reseed against a specific env file: `ENV_FILE=.env.custom.local ALLOW_DB_WIPE=true pnpm seed:fresh`

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

The classroom archive recovery rehearsal runs only against an already-started local Supabase stack:

```bash
pnpm verify:classroom-archive-recovery
```

The command derives its credentials from `supabase status`, requires the local Supabase demo
service-role JWT and an exact destructive-operation acknowledgement, and rejects non-loopback URLs.
It creates and removes only a uniquely identified synthetic fixture. It must never be pointed at a
hosted or production project.

The production archive inventory is read-only and requires an exact expected project ref:

```bash
pnpm verify:classroom-archive-inventory -- \
  --expected-project-ref "$(cat supabase/.temp/project-ref)"
```

It validates deployed archive/Gradex contracts and exposed PostgREST relationships, then reports
privacy-safe row and managed-object sizing for hot archived classrooms. The direct database catalog
audit documented in `docs/guidance/classroom-lifecycle-archives.md` remains separately required. The
inventory does not create an archive or modify database or Storage state.

The named production round-trip runner has separate read-only preparation and explicitly
acknowledged mutation/resume modes:

```bash
pnpm canary:classroom-archive-production -- prepare --plan "$HOME/.pika/archive-canary.json"
pnpm canary:classroom-archive-production -- execute --plan "$HOME/.pika/archive-canary.json"
pnpm canary:classroom-archive-production -- resume --plan "$HOME/.pika/archive-canary.json"
```

Use it only under the migration, catalog, deployment, headroom, named-target, immutable-plan, and
cleanup-disabled procedure in `docs/guidance/classroom-lifecycle-archives.md`.

---

## Environment Variables (required)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SESSION_SECRET` (>=32 chars for iron-session)
- `DEV_TEACHER_EMAILS` (comma-separated)
- `ENABLE_MOCK_EMAIL` (`true` to log verification/reset codes)
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET` (required for protected cron endpoints; Vercel sends `Authorization: Bearer <CRON_SECRET>`; cron schedules are configured in `vercel.json` or the Vercel dashboard; on the Hobby plan, schedules must run at most once per day)
- `DEEPSEEK_API_KEY` (optional; required for assignment, test, and repository-review AI grading)
- `DEEPSEEK_GRADING_MODEL` (optional grading model override; defaults to `deepseek-flash`)
- `OPENAI_API_KEY` (optional; required for nightly log summaries, developer feedback extraction, curriculum import, and Blueprint test/assignment drafting)
- `OPENAI_SUMMARY_MODEL` / `OPENAI_DEVELOPER_FEEDBACK_MODEL` (optional model overrides)
- `OPENAI_BLUEPRINT_DRAFT_MODEL` (optional Blueprint drafting model override; defaults to `gpt-5-mini`)
- `SUPABASE_ACCESS_TOKEN` (operator-only; required by the named production archive canary for
  read-only pre/post database-size evidence)

Classroom archive rollout controls are optional and disabled by default. Cold compaction requires
`CLASSROOM_ARCHIVE_COMPACTION_ENABLED=true` plus exact UUID matches in both
`CLASSROOM_ARCHIVE_COMPACTION_TEACHER_IDS` and `CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS`. The
coordinator is server-only and has no route or schedule; migration application and a named canary
still require explicit human approval. The named round-trip canary keeps every source and Gradex
cleanup gate disabled and immediately restores the classroom after cold compaction.

Source-object deletion is separately disabled by default. Migration 096 transactionally fences
`assignment-artifacts`; embedded-reference buckets remain ineligible. The manual route requires two
independent gates plus one exact compaction operation UUID, and bounds both new reservations and
claims to one object. It is not scheduled in `vercel.json`.

Abandoned export/restore upload cleanup is independently disabled by default with
`CLASSROOM_ARCHIVE_OBJECT_CLEANUP_ENABLED=false`. When enabled, the authenticated daily history cron
first expires stale snapshots, then uses database leases to delete only objects authorized by
terminal, non-retryable operations.

Legacy anon/service keys are supported but publishable/secret are preferred.

---

## Feature Overview

1) **Authentication**: Email verification + password. Endpoints for signup, verify-signup, create-password, login, forgot/reset password.

2) **Daily Journal**: Per-classroom entry with Toronto midnight cutoff; present/absent attendance; history view.

3) **Teacher Dashboard**: Attendance matrix, entry drill-down, class days management, CSV export.

4) **Classrooms & Roster**: Create classes, share join code/link, upload roster CSV, manage enrollments.

5) **Assignments**: Create assignments per classroom; students edit with autosave and submit/unsubmit; teachers view stats and read-only docs. Assignment editor history is served by `src/app/api/assignment-docs/[id]/history/route.ts`.

6) **Tests and Grades**: Tests support student attempts and teacher grading. Teacher Gradebook and Student Grades are implemented; see [Student Grades](../guidance/student-grades.md) for visibility and calculation rules. The broader Gradebook breakdown epic has separate exit gates.

7) **Announcements and course authoring**: Classrooms have teacher-authored announcements. Course blueprints support versioned authoring and classroom instantiation; see [Blueprint packages](../guidance/course-blueprint-packages.md).

---

## Deployment

- Host on Vercel; configure env vars in dashboard; set `ENABLE_MOCK_EMAIL=false` and add real email provider before production.
- Supabase Cloud for DB; enable connection pooling; treat migrations as a separately authorized deploy step.
- If using cron, configure schedules in `vercel.json` or the Vercel dashboard for production. On the Hobby plan, Vercel cron jobs must run at most once per day, so do not add sub-daily schedules. Current repo-managed schedules: nightly log summaries at `0 6 * * *` (06:00 UTC) and history cleanup at `0 7 * * *` (07:00 UTC).

---

## Roster + Enrollment Rules

- CSV upload populates a **classroom roster allow-list** (no auto-enrollment).
- Students can join only if their signed-in email is on the roster and the classroom has enrollment enabled.
- Teachers can disable enrollment per classroom in Settings.

---

## Troubleshooting

- **Server won’t start**: check Node 24.x, `.env.local`, clear `.next`.
- **pnpm thinks you’re on the wrong Node version**: your `pnpm` binary is being executed by a different `node` than your shell (common when an older global pnpm is earlier in `PATH`). Fix with Corepack:
  - `corepack enable`
  - `corepack prepare pnpm@10.25.0 --activate`
  - Re-open the terminal and re-check: `node -v`, `pnpm -v`, `pnpm exec node -v`
- **Supabase issues**: verify keys, ensure migrations applied, review RLS if access errors.
- **Emails not arriving**: ensure mock mode expected; otherwise implement provider in `email.ts`.
- **Timezone/attendance**: ensure server runs with America/Toronto assumptions; tests cover DST via `date-fns-tz`.

---

For architecture, see `docs/core/architecture.md`. For testing, see `docs/core/tests.md`. For UI, see `DESIGN.md`.
