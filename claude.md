# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# PROJECT OVERVIEW

**Pika** is a student daily log and attendance tracking application for an online high school course (GLD2O). Students submit daily journal entries before midnight (America/Toronto timezone), and teachers monitor attendance and read student submissions through a dashboard.

**Status**: Greenfield project - specification complete, implementation in progress.

---

# TECH STACK

- **Framework**: Next.js 14+ (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Passwordless email codes (custom implementation)
- **Styling**: Tailwind CSS
- **Testing**: Vitest + React Testing Library
- **Deployment**: Vercel

---

# DEVELOPMENT COMMANDS

```bash
# Development
npm run dev              # Start dev server on localhost:3000
npm run build            # Production build
npm start                # Run production build locally

# Testing
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:ui          # Vitest UI

# Database (if using local Supabase)
supabase start           # Start local instance
supabase db reset        # Reset and re-run migrations
supabase migration new <name>  # Create new migration
```

---

# CODE ARCHITECTURE

## Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── auth/          # Authentication endpoints
│   │   ├── student/       # Student data endpoints
│   │   └── teacher/       # Teacher data endpoints
│   ├── student/           # Student-facing pages
│   ├── teacher/           # Teacher-facing pages
│   ├── login/
│   ├── verify-code/
│   └── logout/
├── components/            # React components
├── lib/                   # Core utilities and business logic
│   ├── supabase.ts       # Supabase client
│   ├── auth.ts           # Session management
│   ├── attendance.ts     # Attendance calculation logic
│   ├── crypto.ts         # Code generation/hashing
│   └── timezone.ts       # America/Toronto timezone utilities
└── types/                # TypeScript type definitions

supabase/migrations/      # Database migrations
tests/                    # Test files
```

## Key Architectural Patterns

### 1. Authentication Flow
- **Passwordless email codes** (NOT OAuth)
- User requests code → backend hashes & stores in DB with 10min expiry
- User verifies code → backend creates session with HTTP-only cookie
- Rate limiting: max attempts per code, max requests per email/hour
- Roles: `student` or `teacher` (assigned based on email or DB record)

### 2. Attendance Logic
Core function in `src/lib/attendance.ts`:

```typescript
function computeAttendanceStatusForStudent(
  classDays: ClassDay[],
  entries: Entry[]
): Record<string, AttendanceStatus>
```

**Rules**:
- No entry for date → `absent`
- Entry with `on_time = true` → `present`
- Entry with `on_time = false` → `late`

**On-time determination**: Entry is on-time if `updated_at` (converted to America/Toronto) is before midnight (start of next day) in Toronto time

### 3. Database Schema

**users**
- `id` (uuid PK), `email` (unique), `role` ('student'|'teacher'), `created_at`

**login_codes**
- `id`, `email`, `code_hash`, `expires_at`, `used`, `attempts`, `created_at`
- Indexes: email, expires_at

**class_days**
- `id`, `course_code`, `date`, `prompt_text`, `is_class_day`
- Unique: (course_code, date)

**entries**
- `id`, `student_id` (FK), `course_code`, `date`, `text`, `minutes_reported`, `mood`, `created_at`, `updated_at`, `on_time`
- Unique: (student_id, course_code, date)

### 4. Route Protection
- Student routes: check `role = 'student'` and `student_id` matches session
- Teacher routes: check `role = 'teacher'`
- Implement middleware or layout-level auth checks

---

# CRITICAL IMPLEMENTATION DETAILS

## Timezone Handling
**ALWAYS use America/Toronto timezone** for deadline calculations. The `on_time` field must be computed by:
1. Converting `updated_at` from UTC to America/Toronto
2. Comparing against midnight (start of next day) in Toronto time

## Security Requirements
- **Hash all login codes** before storing (use bcrypt or similar)
- **Never store plaintext codes**
- Set HTTP-only, secure, SameSite cookies for sessions
- Validate email domain against `ALLOWED_EMAIL_DOMAIN` env var
- Rate limit code requests and verification attempts

## Pure Functions for Testing
Keep attendance logic pure and testable:
- `computeAttendanceStatusForStudent()` - no side effects
- `isOnTime(updatedAt: Date, date: string)` - timezone-aware comparison
- Write comprehensive unit tests for these functions

---

# TESTING STRATEGY

## Required Unit Tests
- `computeAttendanceStatusForStudent()` - various scenarios
- `isOnTime()` - timezone edge cases
- `requestCode()` - code generation, hashing, rate limiting
- `verifyCode()` - validation, expiry, attempt limits

## Required Component Tests
- Student daily form renders correctly
- Teacher dashboard attendance matrix renders

## Optional E2E
- 1-2 Playwright tests for critical flows

---

# ENVIRONMENT VARIABLES

Required in `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=  # New format: sb_publishable_...
SUPABASE_SECRET_KEY=                   # New format: sb_secret_...

# Email (for sending codes)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Auth
DEV_TEACHER_EMAILS=                    # Comma-separated list for development
SESSION_SECRET=
SESSION_MAX_AGE=604800

# Dev flags
ENABLE_MOCK_EMAIL=true
```

**Note**: Supabase now uses publishable/secret keys (starting with `sb_publishable_` and `sb_secret_`) instead of the legacy anon/service_role keys. The code supports both formats.

---

# UI GUIDELINES

- **Mobile-first** design for student experience
- **Tailwind CSS** only - no component libraries
- **Simple icons**: 🟢 present, 🟡 late, 🔴 absent
- **Teacher dashboard**: Sticky left column (student names), scrollable dates
- Keep UI minimal and functional

---

# MVP IMPLEMENTATION PHASES

When building the complete MVP, follow this order:

## Phase 0 — Setup
- Initialize Next.js with TypeScript
- Configure Tailwind CSS
- Set up Supabase client
- Create environment variables template

## Phase 1 — Auth
- Create database migrations for all tables
- Implement `/api/auth/request-code` with hashing & rate limiting
- Implement `/api/auth/verify-code` with session creation
- Build login and verify-code pages
- Create session utilities and middleware

## Phase 2 — Student Experience
- Build `/student/today` with journal form
- Build `/student/history` with attendance indicators
- Create student API routes for entries
- Implement timezone handling and `on_time` calculation

## Phase 3 — Teacher Dashboard
- Build attendance matrix component
- Implement entry detail modal
- Create CSV export functionality
- Teacher API routes for attendance data

## Phase 4 — Tests & Polish
- Write unit tests for core utilities
- Add component tests
- Security hardening review
- Documentation cleanup

---

# WHEN ASKED TO "BUILD THE MVP"

Generate the complete, working application including:

1. **All source files**: migrations, API routes, components, pages, utilities, tests
2. **Configuration**: Tailwind, Supabase client, session handling
3. **Documentation**: README with setup instructions, environment variables, deployment guide
4. **Coherent implementation**: Ensure all imports, types, and file paths align

**Do not ask follow-up questions** - make reasonable decisions and document them.

---

# DEPLOYMENT

**Target**: Vercel

**Steps**:
1. Create Supabase project and apply migrations
2. Configure environment variables in Vercel
3. Connect GitHub repo to Vercel project
4. Deploy automatically on push to main

**Database**: Use Supabase hosted Postgres (not local)

**Email**: Configure real SMTP for production (mock in development)
