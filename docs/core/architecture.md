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
│   ├── api/                       # API routes (~130 route files)
│   │   ├── auth/                  # signup, verify-signup, create-password, login, reset, me, logout
│   │   ├── student/               # classrooms, join, entries, assignments, quizzes, tests
│   │   ├── teacher/               # classrooms, roster, class-days, attendance, assignments,
│   │   │                          #   quizzes, tests, gradebook, announcements, resources
│   │   └── assignment-docs/       # fetch/update/submit/unsubmit/history assignment docs
│   ├── login/, signup/, forgot-password/, reset-password/…
│   ├── student/                   # student today/history dashboards
│   ├── teacher/                   # teacher dashboard
│   └── classrooms/[classroomId]/  # classroom detail page with ~19 tabs
│       └── ClassroomPageClient.tsx # ~1500 LOC god component (gradual decomposition ongoing)
├── components/                    # Feature components and modals
│   ├── QuizDetailPanel.tsx        # Quiz editor/viewer (~900 LOC, draft mode)
│   ├── AssignmentModal.tsx        # Assignment editor (~900 LOC, scheduling)
│   ├── TestStudentGradingPanel.tsx # Per-student test grading
│   └── ...
├── hooks/                         # Custom React hooks (extracted from components)
├── lib/                           # Core utilities
│   ├── api-handler.ts             # withErrorHandler wrapper + ApiError (MANDATORY for routes)
│   ├── request-cache.ts           # Client-side in-memory cache (15–20s TTL)
│   ├── tiptap-content.ts          # Tiptap editor utilities + parseContentField
│   ├── ai-grading.ts              # AI grading for assignments (OpenAI)
│   ├── ai-test-grading.ts         # AI grading for tests (OpenAI, gpt-5-nano)
│   ├── server/
│   │   ├── assessment-drafts.ts   # Unified quiz/test draft system (JSON Patch)
│   │   └── tests.ts               # Test query helpers
│   ├── assignments.ts, quizzes.ts, test-responses.ts, scheduling.ts …
│   └── auth.ts, crypto.ts, timezone.ts, attendance.ts …
├── types/                         # Shared TypeScript types (src/types/index.ts)
└── ui/                            # Design-system primitives (import from @/ui NOT @/components)
    ├── Button, Input, FormField, Select, AlertDialog, ConfirmDialog, Card, Tooltip, SplitButton

supabase/migrations/               # 001–045+ schema + RLS
tests/                             # Vitest unit + API suites
.claude/commands/                  # Claude Code slash commands
.codex/prompts/                    # Codex CLI prompt mirrors
.codex/skills/                     # Codex skills with companion scripts
```

---

## Key Patterns

### UI/Theming (Required)
- **All UI must use semantic design tokens** — NOT raw color or `dark:` classes in app code.
- `dark:` classes are **PROHIBITED in all app code** outside `src/ui/` primitives.
- Semantic token pattern:
  ```tsx
  // ✅ CORRECT — semantic tokens
  <div className="bg-surface text-text-default border-border">
  <p className="text-text-muted">Secondary text</p>

  // ❌ WRONG — dark: classes in app code (blocked by CI)
  <div className="bg-white dark:bg-gray-900">
  ```
- Common tokens: `bg-page`, `bg-surface`, `bg-surface-2`, `text-text-default`, `text-text-muted`,
  `border-border`, `text-primary`, `text-danger`, `text-success`, `text-warning`
- Full token reference: `src/ui/README.md` | Design rules: `docs/core/design.md`

### Authentication (Primary)
- **Signup**: `/api/auth/signup` stores a verification code (mock-emailed); `/verify-signup` validates; `/create-password` hashes password (bcrypt), sets session.
- **Login**: `/api/auth/login` with email/password.
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

### API Route Error Handling (Required Pattern)
All API routes **must** use the `withErrorHandler` wrapper from `@/lib/api-handler`:

```ts
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'

export const GET = withErrorHandler('GetClassrooms', async (request) => {
  const user = await requireRole('teacher')
  // ... just write the happy path, errors are caught automatically
  throw new ApiError(400, 'Missing required field')  // for domain errors
})
```

**Error mapping** (handled automatically by the wrapper):
- `AuthenticationError` → 401
- `AuthorizationError` → 403
- `ApiError(status, message)` → custom status code
- `ZodError` → 400 with field-level messages (e.g. `"email: Invalid email format"`)
- Unknown errors → 500 (logged to console)

**Do NOT** write manual try/catch blocks with error.name checks in new routes.

Use `/migrate-error-handler` slash command to convert existing manual routes.

### Client-Side Data Fetching (Required Pattern)
Use `fetchJSONWithCache` from `@/lib/request-cache` for repeated client-side API calls.
This avoids duplicate in-flight requests and caches responses for 15–20 seconds.

```ts
import { fetchJSONWithCache } from '@/lib/request-cache'

// ✅ CORRECT — deduplicated + cached
const data = await fetchJSONWithCache(
  `gradebook:${classroomId}:${studentId}`,
  () => fetch(`/api/teacher/gradebook?...`).then(r => r.json()),
  60_000  // 1 min TTL
)

// ❌ WRONG — raw fetch in components (causes duplicate requests, no caching)
const data = await fetch(`/api/teacher/gradebook?...`).then(r => r.json())
```

Use raw `fetch()` only for one-off mutations (POST/PATCH/DELETE) or when freshness is critical.

### Assessments Pattern
Pika has two assessment types: **quizzes** (graded by `show_results` flag) and **tests**
(graded manually, returned via `returned_at`). They are stored in separate tables but share
logic in the app layer:

- **Discrimination**: `assessment_type: 'quiz' | 'test'` on both `quizzes` and `tests` tables
- **Quiz status**: `getStudentQuizStatus()` from `@/lib/quizzes` — uses `show_results` field
- **Test status**: `getStudentTestStatus()` from `@/lib/quizzes` — uses `returned_at` field
- **Draft editing**: unified `assessment_drafts` table + JSON Patch via `@/lib/server/assessment-drafts`
- **Scheduling**: `combineScheduleDateTimeToIso()` / `isScheduleIsoInFuture()` from `@/lib/scheduling`
- **AI grading** (tests only): `src/lib/ai-test-grading.ts` — reference answer SHA-256 cached per question

### Content Fields
Assignment docs, quiz/test questions, and lesson plans store content as Tiptap JSON.
Always parse content using the shared utility:

```ts
import { parseContentField } from '@/lib/tiptap-content'

const content = parseContentField(doc.content)  // handles string or object
```

**Never define a local `parseContentField` function in a route file.**

Announcement content is stored as markdown text in `announcements.content` and rendered through
`LimitedMarkdown` via `AnnouncementContent`.

### Migration Shims
When a DB migration is applied in stages (some environments may not have it yet), code uses
guard patterns that should be removed once the migration is universally applied:

```ts
// Pattern: isMissing<Table>Error — check PGRST205 to detect missing column/table
// Remove these when migration 0XX is confirmed applied everywhere
if (isMissingAssessmentDraftsError(error)) { /* graceful fallback */ }
```

Search for `TODO(cleanup-0XX)` comments to find shims scheduled for removal.

### Request Validation (Zod)
Use Zod schemas from `@/lib/validations/` for request body/query validation:

```ts
import { z } from 'zod'
const schema = z.object({ email: z.string().email(), password: z.string().min(8) })
const body = schema.parse(await request.json())  // throws ZodError on invalid
```

### Email-Based Role Detection (YRDSB-Specific)
Role detection in `isTeacherEmail()` (`src/lib/auth.ts`) uses a **YRDSB-specific heuristic**:
- `@yrdsb.ca` or `@gapps.yrdsb.ca` with **numeric-only** local part → **student** (e.g., `123456789@gapps.yrdsb.ca`)
- `@yrdsb.ca` or `@gapps.yrdsb.ca` with **alphabetic** local part → **teacher** (e.g., `john.smith@gapps.yrdsb.ca`)
- Other domains → student by default, unless listed in `DEV_TEACHER_EMAILS` env var

This is non-portable; adapting for other schools requires updating `isTeacherEmail()`.

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

## Query Patterns (IMPORTANT for AI agents)

### N+1 Query Prevention
**Never** loop over rows and issue individual queries. Always use Supabase joins or `IN` clauses:

```ts
// ✅ CORRECT — single query with join
const { data } = await supabase
  .from('classroom_enrollments')
  .select('student_id, users!inner(id, email)')
  .eq('classroom_id', classroomId)

// ✅ CORRECT — batch query with IN
const { data: docs } = await supabase
  .from('assignment_docs')
  .select('*')
  .in('student_id', studentIds)

// ❌ WRONG — N+1 pattern (one query per student)
for (const student of students) {
  const { data } = await supabase
    .from('entries')
    .select('*')
    .eq('student_id', student.id)  // This runs N times!
}
```

### When to Create an Index
Add a database index (in a new migration) when:
1. A query filters on a column that isn't the primary key
2. A composite query filters on two+ columns together (e.g., `WHERE classroom_id = X AND date = Y`)
3. A query uses `ORDER BY` on a non-indexed column in large tables
4. You observe slow queries in production logs

Existing indexes (migration 038):
- `entries(classroom_id, date)` and `entries(student_id, classroom_id, date)`
- `assignment_docs(assignment_id, student_id)`
- `classroom_enrollments(student_id)`
- `class_days(classroom_id, date)`
- `assignment_doc_history(assignment_doc_id, created_at DESC)`

---

## Database Schema (Migrations 001–045+)

### Core
- `users` — `id`, `email`, `role`, `email_verified_at`, `password_hash`, timestamps
- `verification_codes` — signup/reset codes with expiry/attempts
- `student_profiles` — student metadata linked to `users`
- `classrooms` — owned by teacher (`teacher_id`); `name`, `join_code`, `allow_enrollment`
- `classroom_enrollments` — student membership per classroom
- `classroom_roster` — email allow-list for enrollment gating
- `class_days` — `classroom_id`, `date`, `is_class_day`
- `entries` — `student_id`, `classroom_id`, `date`, `text`, `mood`, `on_time`, timestamps

### Assignments
- `assignments` — `classroom_id`, `title`, `description`, `due_at`, `created_by`, `released_at`, `scheduled_release_at`
- `assignment_docs` — one per (assignment, student); `content` (Tiptap JSON), `is_submitted`, `submitted_at`, `score`, `feedback`, `returned_at`
- `assignment_doc_history` — change history for assignment docs

### Assessments (Quizzes & Tests)
> Both stored in separate tables but share `assessment_type: 'quiz' | 'test'` discrimination in app logic.
- `quizzes` — `classroom_id`, `title`, `assessment_type`, `show_results`, `released_at`, `scheduled_release_at`
- `quiz_questions` — `quiz_id`, `question_text`, `options` (JSONB array), `correct_option`, `points`, `order`
- `quiz_responses` — `student_id`, `quiz_id`, `question_id`, `selected_option`, `is_correct`, `points_earned`
- `tests` — `classroom_id`, `title`, `assessment_type`, `released_at`, `returned_at`, `scheduled_release_at`
- `test_questions` — `test_id`, `question_text`, `question_type` (`multiple_choice` | `open_response`), `options`, `correct_option`, `points`, `order`, `reference_answer`, `reference_answer_cache_key`
- `test_responses` — `student_id`, `test_id`, `question_id`, `selected_option`, `response_text`, `score`, `feedback`, `graded_at`, `ai_grading_model`, `returned`
- `test_attempts` — `student_id`, `test_id`; tracks submission/return lifecycle
- `assessment_drafts` — `assessment_id`, `assessment_type`, `content` (JSONB), `version`, `created_by`; used for collaborative editing with JSON Patch

### Content
- `announcements` — `classroom_id`, `content` (markdown text), `created_by`, timestamps
- `resources` — `classroom_id`, `title`, `url`, `description`, timestamps
- `lesson_plans` — `classroom_id`, `class_day_id`, `content` (Tiptap JSON)

**RLS Highlights**
- Auth tables (`verification_codes`) are server-managed only (service role).
- All other tables: RLS disabled; app enforces ownership/enrollment via `requireRole` + service role checks.
- Assignments/docs: teachers of the classroom read-all; students read/write their own docs only.

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

For UI/UX patterns see `docs/core/design.md`; for testing approach see `docs/core/tests.md`; for setup see `docs/core/project-context.md`; for routing architecture see `docs/core/route-patterns.md`.
