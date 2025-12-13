# Pika - Student Daily Log, Classrooms, and Assignments

Next.js application for classroom attendance, daily journals, and assignment submissions backed by Supabase.

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

## Prerequisites

- Node.js 22.x
- Supabase project (cloud or local)
- Git

## Getting Started

1) **Clone**
```bash
git clone <repository-url>
cd pika
```

2) **Install**
```bash
npm install
```

3) **Supabase setup**
- Create a project and grab:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (starts with `sb_publishable_`)
  - `SUPABASE_SECRET_KEY` (starts with `sb_secret_`)
- Apply migrations `supabase/migrations/001` through `008` (users, verification codes, class days, entries, auth refactor, classrooms, assignments, legacy cleanup).
  - Dashboard: run each file in order.
  - CLI: `supabase db push`

4) **Generate session secret**
```bash
npm run generate:secret
```
Add to `.env.local` as `SESSION_SECRET`.

5) **Environment variables**
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key-here
SUPABASE_SECRET_KEY=sb_secret_your-key-here

# Session
SESSION_SECRET=your-64-char-hex-secret

# Roles
DEV_TEACHER_EMAILS=teacher@example.com,admin@yrdsb.ca

# Email (mock logs codes to console in dev)
ENABLE_MOCK_EMAIL=true

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron (Vercel Cron Jobs)
CRON_SECRET=generate-a-secure-random-secret
```

Cron schedules are configured in the Vercel dashboard (recommended: production only).
Recommended schedule: `0 6 * * *` (06:00 UTC → 1:00am Toronto in winter, 2:00am in summer).

6) **Seed data (optional)**
```bash
npm run seed
```

If you keep multiple Supabase environments, you can point seed scripts at a specific env file:
```bash
ENV_FILE=.env.staging.local ALLOW_DB_WIPE=true npm run seed:fresh
```

7) **Run dev server**
```bash
npm run dev
```
Visit http://localhost:3000

## Development

### Tests
```bash
npm test          # all tests
npm run test:watch
npm run test:ui
```

### Build
```bash
npm run build
npm start
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
├── supabase/migrations/             # 001–007 schema + RLS
├── tests/                           # Vitest suites (unit + API)
└── scripts/                         # Setup/seed utilities
```

## Deployment (Vercel)

1. Push to GitHub and import into Vercel.
2. Configure env vars (match `.env.local`); set `ENABLE_MOCK_EMAIL=false` and wire a real email provider in `email.ts` for production.
3. Build command `npm run build`; output `.next`.

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

Open an issue or PR with questions or fixes.
