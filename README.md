# Pika - Student Daily Log, Classrooms, and Assignments

Next.js application for classroom attendance, daily journals, and assignment submissions backed by Supabase.

**Contributing?** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the PR workflow and what you need to get a local environment running.

## For AI Agents

Start with: `.ai/START-HERE.md`

Key docs:
- `docs/ai-instructions.md` (required reading order + constraints)
- `docs/core/architecture.md` (architecture invariants)
- `docs/issue-worker.md` (issue workflow)

Feature/status tracking:
```bash
node scripts/features.mjs summary
node scripts/features.mjs next
```

## Features

### For Students
- Email + password authentication (email verification required)
- Join classrooms via invite code
- Daily journal entry per classroom with Toronto-time deadline
- Attendance history with present/absent indicators
- Assignment editor with autosave, submit/unsubmit, and status badges

### For Teachers
- Create/manage classrooms with join codes and links
- Upload roster CSV, manage enrollments, and class days calendar
- Attendance matrix (students × dates) with entry drill-down and CSV export
- Create assignments with due dates and track submission stats
- Read-only view of student assignment docs

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Email verification + password (bcrypt)
- **Session Management**: iron-session (HTTP-only cookies)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library

## License

Copyright (c) 2026 Stewart Chan. All rights reserved.

Pika is a CodePet project. This repository is publicly visible for review and
evaluation only. No permission is granted to use, copy, modify, distribute,
host, commercialize, or create derivative works without prior written
permission. See [LICENSE](./LICENSE).

## Prerequisites

- Node.js 24.x (use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm): `nvm install 24`)
- pnpm via corepack (`corepack enable` — the repo pins the pnpm version)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (`brew install supabase/tap/supabase`)
- Git

You do **not** need a Vercel account for local development.

## Getting Started

1) **Clone**
```bash
git clone https://github.com/codepetca/pika.git
cd pika
```

2) **Install**
```bash
corepack enable
pnpm install
```

3) **Set up a database (your own Supabase)**

Every developer runs against their own Supabase database. Pick one:

**Option A — free Supabase cloud project (simplest):**
1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. From Project Settings → API, note:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (starts with `sb_publishable_`)
   - `SUPABASE_SECRET_KEY` (starts with `sb_secret_`)
3. Apply all migrations (there are ~80 — do **not** run them by hand in the dashboard):
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — local Supabase (Docker required):**
```bash
supabase start   # applies supabase/migrations/ automatically
```
Use the URL and keys it prints.

4) **Environment variables**
```bash
cp .env.example .env.local
```

Only these are **required** for local dev:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SESSION_SECRET=...            # generate with: pnpm run generate:secret
ENABLE_MOCK_EMAIL=true        # verification codes print to the dev server console
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEV_TEACHER_EMAILS=teacher@example.com   # emails that get the teacher role
```

Everything else in `.env.example` is **optional** and only needed for specific features:
- `BREVO_*` — real email delivery (mock email covers dev)
- `OPENAI_API_KEY` — AI grading and log summaries
- `GRADEX_*` — Gradex grading integration
- `CRON_SECRET` — Vercel cron endpoints (production concern)
- `GITHUB_PAT` / `GITHUB_FEEDBACK_TOKEN` — repo review helper scripts

Cron schedules are configured in the Vercel dashboard (recommended: production only).
Recommended schedule: `0 6 * * *` (06:00 UTC → 1:00am Toronto in winter, 2:00am in summer).

5) **Seed data (optional)**
```bash
pnpm run seed
```

If you keep multiple Supabase environments, you can point seed scripts at a specific env file:
```bash
ENV_FILE=.env.staging.local ALLOW_DB_WIPE=true pnpm run seed:fresh
```

6) **Run dev server**
```bash
pnpm dev
```
Visit http://localhost:3000

## Development

### Tests
```bash
pnpm test
pnpm run test:watch
pnpm run test:ui
```

### UI Review (Gallery + Snapshots)

Enable the UI gallery (recommended on staging):
```env
ENABLE_UI_GALLERY=true
```

Visit `/__ui` (e.g. `https://your-url/__ui`).

Run Playwright snapshots (generates local screenshots + an HTML report).

**Local dev workflow (recommended)**:
```bash
# 1) Seed a dev DB with password-based accounts (teacher + students)
ENV_FILE=.env.local ALLOW_DB_WIPE=true pnpm run seed:fresh

# 2) Enable the gallery locally (optional)
export ENABLE_UI_GALLERY=true

# 3) Start the dev server
pnpm dev

# 4) In another terminal, install browsers once and run snapshots
pnpm run e2e:install
E2E_BASE_URL=http://localhost:3000 pnpm run e2e:snapshots

# 5) View the report
pnpm exec playwright show-report playwright-report
```

**Staging workflow**:
```bash
E2E_BASE_URL=https://your-staging-url \
E2E_TEACHER_EMAIL=your-seeded-teacher@example.com \
E2E_STUDENT_EMAIL=your-seeded-student@example.com \
E2E_PASSWORD=your-seeded-password \
pnpm run e2e:snapshots

pnpm exec playwright show-report playwright-report
```

### Build
```bash
pnpm build
pnpm start
```

## Authentication (Primary Flow)

1. **Sign up**: user enters email on `/signup`; `/api/auth/signup` stores a verification code and emails/logs it.
2. **Verify email**: user submits code to `/api/auth/verify-signup`; on success they are directed to create a password.
3. **Create password**: `/api/auth/create-password` hashes password with bcrypt, creates session, and redirects by role.
4. **Login**: `/api/auth/login` with email + password (lockout after 5 failed attempts for 15 minutes).
5. **Forgot password**: `/api/auth/forgot-password` sends reset code; `/api/auth/reset-password/verify` + `/confirm` set a new password.

Session is stored in an HTTP-only, SameSite=Lax cookie via iron-session.

Password-based flow only; code-based login has been removed.

## Role Determination

- Teacher if email ends with `@gapps.yrdsb.ca` or `@yrdsb.ca`, or listed in `DEV_TEACHER_EMAILS`.
- Otherwise student.

## Attendance Logic

- Status is **present** when an entry exists for a class day; **absent** otherwise.
- Class days honor `is_class_day` and use **America/Toronto** timezone for deadlines.
- `on_time` is computed when saving but UI shows present/absent only.

## Classrooms & Assignments

- Teachers: create classrooms, manage class days, upload roster CSV, share join codes/links, create assignments, view stats, export attendance CSV.
- Students: join classrooms with a code, submit daily entries, edit assignments with autosave and submit/unsubmit.
- Assignment status helpers live in `src/lib/assignments.ts`.

## Project Structure

```
pika/
├── src/
│   ├── app/
│   │   ├── api/                     # API routes (auth, student, teacher, assignment-docs)
│   │   ├── login/, signup/, forgot-password/, reset-password/
│   │   ├── student/                 # Student dashboard and history
│   │   ├── teacher/                 # Teacher dashboard
│   │   └── classrooms/              # Classroom + assignment views (both roles)
│   ├── components/                  # UI primitives and modals
│   ├── lib/                         # Core logic (auth, crypto, timezone, attendance, calendar, assignments)
│   └── types/                       # Shared TypeScript types
├── supabase/migrations/             # Schema + RLS (apply with supabase db push)
├── tests/                           # Vitest suites (unit + API)
└── scripts/                         # Setup/seed utilities
```

## Deployment (Vercel)

1. Push to GitHub and import into Vercel.
2. Configure env vars (match `.env.local`); set `ENABLE_MOCK_EMAIL=false` and wire a real email provider in `email.ts` for production.
3. Build command `pnpm build`; output `.next`.

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (client-safe) | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | Server key for API routes | `sb_secret_...` |
| `SESSION_SECRET` | 32+ char secret for iron-session | random hex |
| `DEV_TEACHER_EMAILS` | Comma-separated teacher emails (dev) | `teacher@test.com` |
| `ENABLE_MOCK_EMAIL` | Log verification/reset codes instead of sending | `true` |
| `NEXT_PUBLIC_APP_URL` | Base app URL | `http://localhost:3000` |

## Known Limitations

- Email delivery is mocked; production provider not wired.
- Attendance shows present/absent only (no “late” state in UI).
- Holidays/timezone: Ontario defaults and America/Toronto timezone are hardcoded.

## Future Enhancements

- Production email delivery (Resend/SendGrid/etc.)
- Late status display and richer attendance analytics
- Regional holiday configuration
- Notifications for missing entries or upcoming due dates

## Support

Open an issue with questions, or see [CONTRIBUTING.md](./CONTRIBUTING.md) to submit changes.
