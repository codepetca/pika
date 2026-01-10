# Architecture

Defines the system architecture, patterns, and technical details for **Pika**. Primary flow is email verification + password.

---

## System Overview

Pika is a Next.js 14 application deployed on Vercel with a Supabase backend. It uses server components plus API routes, iron-session cookies for auth, and Supabase for persistence.

```
┌────────────────────────────┐
│        Client (RSC)        │
│  Student UI  |  Teacher UI │
└──────────────┬─────────────┘
               │ HTTP
┌──────────────▼─────────────┐
│     Next.js App Router     │
│   /api/auth/*              │
│   /api/student/*           │
│   /api/teacher/*           │
│   /api/assignment-docs/*   │
└──────────────┬─────────────┘
               │ Supabase client
┌──────────────▼─────────────┐
│        Supabase DB         │
│ users, student_profiles    │
│ classrooms, enrollments    │
│ class_days, entries        │
│ assignments, assignment_docs│
│ verification_codes         │
└────────────────────────────┘
```

---

## Directory Structure

```
src/
├── app/
│   ├── api/                       # API routes
│   │   ├── auth/                  # signup, verify-signup, create-password, login, reset, me, logout
│   │   ├── student/               # classrooms, join, entries, assignments
│   │   ├── teacher/               # classrooms, roster, class-days, attendance, assignments, export-csv, entry
│   │   └── assignment-docs/       # fetch/update/submit/unsubmit assignment docs
│   ├── login/, signup/, forgot-password/, reset-password/…
│   ├── student/                   # student today/history dashboards
│   ├── teacher/                   # teacher dashboard
│   └── classrooms/                # shared classroom + assignment views
├── components/                    # UI primitives and modals
├── lib/                           # Core utilities (auth, crypto, timezone, attendance, calendar, assignments)
└── types/                         # Shared TypeScript types

supabase/migrations/               # 001–007 schema + RLS
tests/                             # Vitest unit + API suites
```

---

## Key Patterns

### UI/Dark Mode (Required)
- **All UI components MUST support both light and dark modes**
- Uses Tailwind's `dark:` prefix with `class` strategy (`darkMode: 'class'` in config)
- Standard pattern: `bg-white dark:bg-gray-900`, `text-gray-900 dark:text-white`, etc.
- E2E snapshots test both light and dark modes to ensure visual consistency
- See `docs/core/design.md` and `docs/design-system.md` for complete dark mode patterns

### Authentication (Primary)
- **Signup**: `/api/auth/signup` stores a verification code (mock-emailed); `/verify-signup` validates; `/create-password` hashes password (bcrypt), sets session.
- **Login**: `/api/auth/login` with email/password; lockout after 5 failed attempts for 15 minutes.
- **Forgot/Reset**: `/api/auth/forgot-password` issues reset code; `/reset-password/verify` + `/confirm` update password.
- **Session**: iron-session cookie (`pika_session`), HTTP-only, SameSite=Lax, secure in production.

### Attendance Logic
- Statuses: `present` or `absent` only. Presence is determined by existence of an entry for a class day where `is_class_day=true`.
- `on_time` is computed on write using America/Toronto but UI aggregates to present/absent.
- Class day generation respects weekends/holidays; deadlines use America/Toronto (date-fns-tz).

### Assignments
- Tables: `assignments` (per classroom) and `assignment_docs` (per student/assignment).
- Student editor autosaves via `/api/assignment-docs/[id]` (PATCH), submit/unsubmit via `/submit` and `/unsubmit`.
- Status helpers live in `src/lib/assignments.ts` (`calculateAssignmentStatus`, badge/label helpers).

### Route Protection
- Role check via `requireRole('student' | 'teacher')` in API routes.
- Classroom ownership/enrollment enforced in route logic and RLS.
- Service role Supabase client used in API routes; iron-session used for identity.

---

## Data Flows

### Student Daily Entry
```
POST /api/student/entries { classroom_id, date, text, mood }
1) require student session
2) validate enrollment + class day
3) upsert entry, compute on_time (America/Toronto)
4) return entry; attendance uses presence-only status
```

### Teacher Attendance Dashboard
```
GET /api/teacher/attendance?classroom_id=...
1) require teacher, verify ownership
2) fetch students, class_days, entries
3) compute summary via computeAttendanceStatusForStudent/computeAttendanceRecords
4) render matrix + CSV export via /api/teacher/export-csv
```

### Classroom & Assignment
```
Teachers: create classroom -> share join code -> upload roster CSV -> manage class days -> create assignments.
Students: join classroom (code) -> daily entries -> open assignment -> autosave content -> submit/unsubmit.
```

**Roster + Enrollment gating**
- Roster CSV populates a **classroom allow-list** (`classroom_roster`).
- Students can only join if:
  1) the classroom has `allow_enrollment=true`, and
  2) their signed-in email matches a roster entry for that classroom.
- Uploading roster CSV does **not** auto-enroll students; it only updates the allow-list.

---

## API Surface (non-exhaustive)

**Auth**
- `POST /api/auth/signup`
- `POST /api/auth/verify-signup`
- `POST /api/auth/create-password`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password/verify`
- `POST /api/auth/reset-password/confirm`
- `GET /api/auth/me`
- `POST /api/auth/logout`

**Student**
- `GET /api/student/classrooms`
- `GET /api/student/classrooms/[id]`
- `POST /api/student/classrooms/join`
- `GET /api/student/entries`
- `POST /api/student/entries`
- `GET /api/student/assignments`

**Teacher**
- `GET/POST /api/teacher/classrooms`
- `GET/PATCH/DELETE /api/teacher/classrooms/[id]`
- `POST /api/teacher/classrooms/[id]/roster` (upload/manage roster)
- `GET /api/teacher/class-days`
- `GET /api/teacher/attendance`
- `GET /api/teacher/export-csv`
- `GET/POST /api/teacher/assignments`
- `GET /api/teacher/assignments/[id]`
- `GET /api/teacher/entry/[id]` (entry drill-down)

**Assignments**
- `GET/PATCH /api/assignment-docs/[id]`
- `POST /api/assignment-docs/[id]/submit`
- `POST /api/assignment-docs/[id]/unsubmit`

---

## Database Schema (Migrations 001–008)

- `users` — `id`, `email`, `role`, `email_verified_at`, `password_hash`, timestamps
- `verification_codes` — signup/reset codes with expiry/attempts
- `student_profiles` — student metadata linked to `users`
- `classrooms` — owned by teacher (`teacher_id`)
- `classroom_enrollments` — student membership per classroom
- `class_days` — `classroom_id`, `date`, `is_class_day`
- `entries` — `student_id`, `classroom_id`, `date`, `text`, `mood`, `on_time`, timestamps
- `assignments` — `classroom_id`, `title`, `description`, `due_at`, `created_by`
- `assignment_docs` — one per (assignment, student); `content`, `is_submitted`, `submitted_at`

**RLS Highlights**
- Auth tables (`verification_codes`) are server-managed only.
- Classrooms/enrollments/class_days/entries: RLS disabled for public; app uses service role plus ownership/enrollment checks.
- Assignments/assignment_docs: policies allow teachers of the classroom to read, students to read/write their own docs.

---

## Timezone & Deadlines

- Hardcoded to `America/Toronto` for all deadline logic.
- `isOnTime` and calendar utilities use `date-fns-tz`; DST transitions are handled by the library.
- Attendance uses presence only; late detection is surfaced via assignment status helpers, not attendance.

---

## Testing Targets

- Keep business logic pure (`attendance.ts`, `timezone.ts`, `assignments.ts`) for unit tests.
- API routes should be tested with mocked Supabase client and session guards.
- Coverage priority: auth flows (signup/login/reset), classroom ownership/enrollment, assignment submit/unsubmit, attendance computation, calendar generation.

---

## Deployment Notes

- Vercel for frontend + API; Supabase for DB.
- Use service role key server-side only; publishable key client-side.
- Iron-session cookie (`pika_session`) must be secure in production with a 32+ char secret.

---

For UI/UX patterns see `docs/core/design.md`; for testing approach see `docs/core/tests.md`; for setup see `docs/core/project-context.md`.
