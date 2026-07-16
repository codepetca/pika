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
│   │   ├── student/               # classrooms, join, entries, assignments, tests
│   │   ├── teacher/               # classrooms, roster, class-days, attendance, assignments,
│   │   │                          #   tests, gradebook, announcements, resources
│   │   └── assignment-docs/       # fetch/update/submit/unsubmit/history assignment docs
│   ├── login/, signup/, forgot-password/, reset-password/…
│   ├── student/                   # student today/history dashboards
│   ├── teacher/                   # teacher dashboard
│   └── classrooms/[classroomId]/  # classroom detail page with ~19 tabs
│       └── ClassroomPageClient.tsx # ~1500 LOC god component (gradual decomposition ongoing)
├── components/                    # Feature components and modals
│   ├── TestDetailPanel.tsx        # Test editor/viewer (draft mode)
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
│   │   ├── assessment-drafts.ts   # Legacy quiz + current test draft system (JSON Patch)
│   │   └── tests.ts               # Test query helpers
│   ├── assignments.ts, assessments.ts, test-responses.ts, scheduling.ts …
│   └── auth.ts, crypto.ts, timezone.ts, attendance.ts …
├── types/                         # Domain types plus generated/custom database contracts
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

### Supabase Database Contracts
- `src/types/database.generated.ts` is generated from the public schema and must not be edited manually.
- `src/types/database.ts` composes the generated schema with application-owned JSON, status, and RPC result contracts that PostgreSQL metadata cannot express precisely.
- Both central clients in `src/lib/supabase.ts` use the composed `Database` type. New server data access should flow through those factories.
- Use `TableRow`, `TableInsert`, and `TableUpdate` from `@/types/database` for persisted payloads instead of generic records or local copies of table shapes.
- After changing a migration, start the local Supabase stack through the authorized migration workflow and run `pnpm run db:types:generate`. CI replays migrations in an ephemeral database and runs `pnpm run db:types:check` to reject drift.

### Enforced Module Boundaries
- Run `pnpm check:architecture` before committing changes that move code across layers.
- `src/lib/` cannot depend on presentation or App Router modules (`src/ui`, `src/components`,
  `src/hooks`, or `src/app`).
- `src/ui/` cannot depend on feature presentation, App Router, or server-only modules.
- API routes cannot depend on presentation modules, and components/hooks cannot directly depend
  on API routes or `src/lib/server/`.
- Runtime code in `src/types/` may only depend on other type modules. Type-only imports remain
  allowed so contracts can reference domain types without creating a runtime edge.
- Modules reachable from a `'use client'` entry cannot reach `src/lib/server/`, API routes,
  Supabase runtime clients, Next.js server APIs, `server-only`, or Node built-ins.
- `scripts/architecture-baseline.json` records known client/server debt. It is deletion-only: CI
  fails for new violations and for stale entries after debt is removed.

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

### Authentication (Current And WorkOS-Ready)
- **Signup**: `/api/auth/signup` stores a verification code (mock-emailed); `/verify-signup` validates and issues a short-lived one-time handoff token; `/create-password` requires that token before hashing the password (bcrypt) and setting the session.
- **Login**: `/api/auth/login` with email/password.
- **Forgot/Reset**: `/api/auth/forgot-password` issues reset code; `/reset-password/verify` issues a short-lived one-time handoff token; `/confirm` requires that token before updating the password.
- **Session**: iron-session cookie (`pika_session`), HTTP-only, SameSite=Lax, secure in production.
- **WorkOS migration posture**: keep `public.users.id` as Pika's internal UUID user id. Store the external WorkOS AuthKit id in `public.users.workos_user_id` and map WorkOS sessions to local users before authorization checks.

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
- Classroom ownership/enrollment enforced in route logic using the local Pika user id.
- Server routes use the Supabase service-role client and iron-session identity. Browser-side Supabase table/RPC access is not a supported app data path.

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
Pika exposes **tests** as the active assessment surface. Quiz product routes and tabs have been removed.
Some database history and compatibility response keys still retain legacy quiz naming during the contract transition.
Before changing remaining `quiz` / `quizzes` names, load
[`docs/guidance/legacy-quiz-contract-cleanup.md`](../guidance/legacy-quiz-contract-cleanup.md).

- **Test status**: `getStudentTestStatus()` from `@/lib/tests` — uses `returned_at` field
- **Draft validation**: browser-safe draft contracts live in `@/lib/validations/assessment-drafts`
- **Draft persistence**: unified `assessment_drafts` table + JSON Patch via `@/lib/server/assessment-drafts`
- **Scheduling**: `combineScheduleDateTimeToIso()` / `isScheduleIsoInFuture()` from `@/lib/scheduling`
- **AI grading** (tests only): `src/lib/ai-test-grading.ts` — reference answer SHA-256 cached per question

### Content Fields
Assignment docs, test questions, and lesson plans store content as Tiptap JSON.
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
Treat request bodies, route params, and query values as untrusted. Parse them once at the route boundary with a named, feature-owned Zod schema from `@/lib/validations/`, then pass only the parsed value into server/application code:

```ts
import { updateCourseBlueprintSchema } from '@/lib/validations/course-blueprints'

const body = updateCourseBlueprintSchema.parse(await request.json())
const result = await updateCourseBlueprint(user.id, blueprintId, body)
```

Do not cast `request.json()` to a trusted type or repeat field-by-field validation in a route. `withErrorHandler` converts a thrown `ZodError` into a `400` response. Shared primitives may live in narrowly scoped validation modules, but feature contracts should not accumulate in broad role-based files.

The architecture test prevents new body-reading routes without `*Schema.parse(...)` or `*Schema.safeParse(...)`. Its baseline records existing migration debt and must only shrink as routes are converted. See [`docs/guidance/api-boundary-validation.md`](../guidance/api-boundary-validation.md) for contract ownership, non-JSON boundaries, and baseline maintenance.

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
- `GET/PATCH /api/teacher/classrooms/[id]`
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

## Database Schema (Migrations 001–075+)

### Core
- `users` — `id`, `email`, `role`, `email_verified_at`, `password_hash`, `workos_user_id`, timestamps
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

### Assessments (Tests)
- `tests` — `classroom_id`, `title`, `assessment_type`, `released_at`, `returned_at`, `scheduled_release_at`
- `test_questions` — `test_id`, `question_text`, `question_type` (`multiple_choice` | `open_response`), `options`, `correct_option`, `points`, `order`, `reference_answer`, `reference_answer_cache_key`
- `test_responses` — `student_id`, `test_id`, `question_id`, `selected_option`, `response_text`, `score`, `feedback`, `graded_at`, `ai_grading_model`, `returned`
- `test_attempts` — `student_id`, `test_id`; tracks submission/return lifecycle
- `assessment_drafts` — `assessment_id`, `assessment_type`, `content` (JSONB), `version`, `created_by`; used for collaborative editing with JSON Patch. Legacy quiz drafts may exist for imported/historical data, but product UI no longer creates quizzes.

### Content
- `announcements` — `classroom_id`, `content` (markdown text), `created_by`, timestamps
- `resources` — `classroom_id`, `title`, `url`, `description`, timestamps
- `lesson_plans` — `classroom_id`, `class_day_id`, `content` (Tiptap JSON)
- `log_summaries` — server-managed AI summaries of student daily logs per classroom/date
- `developer_feedback_candidates` — server-managed, sanitized Pika improvement candidates from daily logs and direct Send Feedback submissions for developer review

**RLS Highlights**
- `public` is exposed through Supabase's Data API, so public tables should have RLS enabled even when app traffic is server-routed.
- App data access is server-managed: API routes authorize with `requireAuth()` / `requireRole()` and use the service-role Supabase client.
- `anon` and `authenticated` direct table/RPC privileges are revoked by the auth hardening migration; new direct browser data paths must be explicitly designed and reviewed.
- Some legacy RLS policies still contain `auth.uid()` expressions as defense-in-depth for old Supabase-auth-compatible paths. Do not deepen this pattern for new app authorization, because WorkOS AuthKit sessions do not populate Supabase Auth context automatically.
- Server-managed tables that have no supported direct access path use explicit no-direct-access policies.

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
- Use the Supabase service-role/secret key server-side only. Do not expose it to browsers.
- Supabase public-read storage URLs are product behavior for legacy public buckets, but uploads/deletes should go through server API routes.
- Iron-session cookie (`pika_session`) must be secure in production with a 32+ char secret.

---

For UI/UX patterns see `docs/core/design.md`; for testing approach see `docs/core/tests.md`; for setup see `docs/core/project-context.md`; for routing architecture see `docs/core/route-patterns.md`.
