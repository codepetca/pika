# Architecture

This document defines the system architecture, patterns, and technical implementation details for **Pika**.

---

## System Overview

Pika is a Next.js 14 application deployed on Vercel with a Supabase backend. It follows a standard server-side rendered (SSR) architecture with API routes for backend logic.

```
┌─────────────────────────────────────────────┐
│           Client (Browser)                  │
│  ┌────────────┐          ┌──────────────┐  │
│  │  Student   │          │   Teacher    │  │
│  │   Pages    │          │   Pages      │  │
│  └─────┬──────┘          └──────┬───────┘  │
└────────┼─────────────────────────┼──────────┘
         │                         │
         └────────┬────────────────┘
                  │ HTTP/HTTPS
                  ↓
┌─────────────────────────────────────────────┐
│        Next.js App Router (Vercel)          │
│  ┌───────────────────────────────────────┐  │
│  │  Server Components & API Routes       │  │
│  │  /api/auth/*                          │  │
│  │  /api/student/*                       │  │
│  │  /api/teacher/*                       │  │
│  └────────────────┬──────────────────────┘  │
└───────────────────┼─────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────┐
│         Supabase (PostgreSQL)               │
│  ┌────────────────────────────────────┐    │
│  │  Tables:                           │    │
│  │  - students                        │    │
│  │  - teachers                        │    │
│  │  - entries (journal submissions)   │    │
│  │  - class_days                      │    │
│  │  - assignments                     │    │
│  │  - assignment_docs                 │    │
│  │  - login_codes                     │    │
│  │  - classrooms                      │    │
│  │  - classroom_students              │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── auth/          # Authentication endpoints
│   │   │   ├── request-code/
│   │   │   ├── verify-code/
│   │   │   └── me/
│   │   ├── student/       # Student data endpoints
│   │   │   ├── entries/
│   │   │   ├── classrooms/
│   │   │   └── assignments/
│   │   └── teacher/       # Teacher data endpoints
│   │       ├── attendance/
│   │       ├── class-days/
│   │       ├── classrooms/
│   │       └── assignments/
│   ├── student/           # Student-facing pages
│   │   ├── today/
│   │   ├── history/
│   │   └── classroom/
│   ├── teacher/           # Teacher-facing pages
│   │   ├── dashboard/
│   │   └── classroom/
│   ├── login/
│   ├── verify-code/
│   ├── logout/
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── AttendanceMatrix.tsx
│   ├── EntryForm.tsx
│   ├── Navigation.tsx
│   └── ...
├── lib/                   # Core utilities and business logic
│   ├── supabase.ts       # Supabase client
│   ├── auth.ts           # Session management
│   ├── attendance.ts     # Attendance calculation logic
│   ├── crypto.ts         # Code generation/hashing
│   ├── timezone.ts       # America/Toronto timezone utilities
│   ├── calendar.ts       # Class day generation
│   └── email.ts          # Email sending
└── types/                # TypeScript type definitions
    └── index.ts

supabase/migrations/      # Database migrations
tests/                    # Test files
├── unit/                 # Unit tests
│   ├── attendance.test.ts
│   ├── timezone.test.ts
│   └── crypto.test.ts
└── lib/                  # Core utility tests (TODO)
```

---

## Key Architectural Patterns

### 1. Authentication Flow

**Implementation**: Passwordless email codes (custom, NOT OAuth)

#### Request Code Flow
```
User enters email
    ↓
POST /api/auth/request-code
    ↓
1. Validate email format
2. Check rate limits (max 5 requests/hour per email)
3. Generate random 6-digit code
4. Hash code with bcrypt (cost factor 10)
5. Store hashed code + email + expiry (10min) in login_codes table
6. Send code via email (or log if mock enabled)
    ↓
Response: { success: true }
```

#### Verify Code Flow
```
User enters code
    ↓
POST /api/auth/verify-code {email, code}
    ↓
1. Fetch login_code record by email
2. Check expiry (must be within 10 minutes)
3. Check attempt count (max 3 attempts per code)
4. Verify code with bcrypt.compare()
5. If valid:
   a. Determine role (student or teacher)
   b. Create session with user_id, role, email
   c. Set HTTP-only, secure, SameSite=Lax cookie
   d. Delete login_code record
6. If invalid:
   a. Increment attempt count
   b. Return error
    ↓
Response: { success: true, role, redirect }
```

#### Session Management
- Sessions stored in encrypted HTTP-only cookies
- Session includes: `user_id`, `role`, `email`, `student_id` (if student)
- Session duration: 7 days (configurable via SESSION_MAX_AGE)
- Middleware checks session on protected routes
- Logout clears session cookie

#### Security Requirements
- **Hash all codes** with bcrypt (NEVER store plaintext)
- **HTTP-only cookies** (prevent XSS attacks)
- **Secure flag** (HTTPS only in production)
- **SameSite=Lax** (CSRF protection)
- **Rate limiting**: Max 5 code requests per hour per email
- **Attempt limiting**: Max 3 verification attempts per code
- **Short expiry**: Codes expire after 10 minutes

---

### 2. Attendance Logic

**Core function**: `computeAttendanceStatusForStudent()` in `src/lib/attendance.ts`

#### Function Signature
```typescript
function computeAttendanceStatusForStudent(
  classDays: ClassDay[],
  entries: Entry[]
): Record<string, AttendanceStatus>
```

#### Algorithm
```
For each class day:
  1. Look up entry for that date
  2. If no entry exists:
     → Status: 'absent'
  3. If entry exists and on_time = true:
     → Status: 'present'
  4. If entry exists and on_time = false:
     → Status: 'present' (late submissions still count as present)

Return: { "2024-01-15": "present", "2024-01-16": "absent", ... }
```

**Note**: The current implementation treats late submissions as present. There is no separate "late" status in the UI.

#### On-Time Determination

Function: `isOnTime()` in `src/lib/timezone.ts`

```typescript
function isOnTime(updatedAt: Date, date: string): boolean {
  // Convert UTC timestamp to America/Toronto
  const torontoTime = utcToZonedTime(updatedAt, 'America/Toronto')

  // Get midnight (start of next day) for the class day
  const midnightNextDay = zonedTimeToUtc(
    new Date(date + 'T23:59:59'),
    'America/Toronto'
  )
  midnightNextDay.setSeconds(59) // End of day

  // Entry is on-time if submitted before midnight
  return torontoTime <= midnightNextDay
}
```

**Critical**: All deadline calculations MUST use America/Toronto timezone to handle:
- Daylight Saving Time (DST) transitions
- Different UTC offsets throughout the year
- Students submitting from different timezones

#### Attendance Summary

Computed by `computeAttendanceRecords()`:
```typescript
summary: {
  present: number  // Count of present days
  absent: number   // Count of absent days
}
```

---

### 3. Route Protection

**Middleware**: Checks authentication and authorization on protected routes

#### Student Routes (Require `role = 'student'`)
- `/student/*`
- `/api/student/*`

Additional checks:
- Verify `student_id` in session matches requested student_id
- Prevent students from accessing other students' data

#### Teacher Routes (Require `role = 'teacher'`)
- `/teacher/*`
- `/api/teacher/*`

Additional checks:
- Verify user has teacher role
- Teachers can access all student data (read-only)

#### Implementation Pattern
```typescript
// In API routes or server components
const session = await getSession()

if (!session) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

if (session.role !== 'teacher') {
  return Response.json({ error: 'Forbidden' }, { status: 403 })
}

// Continue with authorized logic...
```

---

## Data Flow Patterns

### Student Journal Submission Flow
```
Student writes entry → Submit button clicked
    ↓
POST /api/student/entries {content, date, student_id}
    ↓
1. Verify session (role = student)
2. Validate student_id matches session
3. Check if entry for date already exists
4. If exists: UPDATE entries SET content, updated_at
5. If not: INSERT new entry
6. Compute on_time field using isOnTime(updated_at, date)
7. Save to database
    ↓
Response: { success: true, entry }
    ↓
UI updates to show submission confirmed
```

### Teacher Dashboard Load Flow
```
Teacher visits /teacher/dashboard
    ↓
Server Component fetches:
1. All students (for left column)
2. Class days (for header row)
3. All entries (for attendance matrix)
    ↓
Server calls computeAttendanceRecords() for each student
    ↓
Server renders AttendanceMatrix component with:
- students (names, IDs)
- classDays (dates)
- attendance data (present/absent per student per day)
    ↓
Client-side interactivity:
- Click cell to view entry details (if present)
- Export CSV button
```

---

## API Route Structure

### Authentication Routes (`/api/auth/*`)
- `POST /api/auth/request-code` — Request login code
- `POST /api/auth/verify-code` — Verify code and create session
- `GET /api/auth/me` — Get current user info
- `POST /api/auth/logout` — Clear session

### Student Routes (`/api/student/*`)
- `GET /api/student/entries` — Get student's entries
- `POST /api/student/entries` — Create/update entry
- `GET /api/student/classrooms` — Get student's classrooms
- `GET /api/student/assignments` — Get assignments for student

### Teacher Routes (`/api/teacher/*`)
- `GET /api/teacher/attendance` — Get attendance data for all students
- `GET /api/teacher/class-days` — Get class days
- `GET /api/teacher/classrooms` — Get all classrooms
- `POST /api/teacher/classrooms` — Create classroom
- `GET /api/teacher/assignments` — Get assignments
- `POST /api/teacher/assignments` — Create assignment

---

## Database Schema

### Core Tables

#### `students`
```sql
id: bigint (PK)
email: text (unique)
name: text
created_at: timestamp
```

#### `teachers`
```sql
id: bigint (PK)
email: text (unique)
name: text
created_at: timestamp
```

#### `entries` (Journal Submissions)
```sql
id: bigint (PK)
student_id: bigint (FK → students.id)
date: date
content: text
on_time: boolean
created_at: timestamp
updated_at: timestamp
```

#### `class_days`
```sql
id: bigint (PK)
date: date (unique)
created_at: timestamp
```

#### `login_codes`
```sql
id: bigint (PK)
email: text
code_hash: text
expires_at: timestamp
attempts: integer (default 0)
created_at: timestamp
```

### Row Level Security (RLS)

**Students**:
- Can SELECT their own entries
- Can INSERT/UPDATE their own entries
- Cannot access other students' data

**Teachers**:
- Can SELECT all entries (read-only)
- Can SELECT all students
- Can INSERT/UPDATE classrooms and assignments

**Public**:
- Can INSERT login_codes (anonymous users requesting codes)
- Can SELECT/UPDATE login_codes for verification

---

## Critical Implementation Details

### Timezone Handling

**Rule**: ALWAYS use America/Toronto timezone for deadline calculations

#### Why?
- Course is based in Ontario, Canada
- Must handle Daylight Saving Time (DST) transitions
- Students may submit from different timezones
- Midnight deadline must be consistent in Toronto time

#### Implementation
```typescript
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz'

const TIMEZONE = 'America/Toronto'

// When checking if on time:
const torontoTime = utcToZonedTime(updatedAt, TIMEZONE)

// When setting midnight deadline:
const midnight = zonedTimeToUtc(new Date(date + 'T23:59:59'), TIMEZONE)
```

#### DST Transitions
- Spring forward: 2:00 AM → 3:00 AM (lose 1 hour)
- Fall back: 2:00 AM → 1:00 AM (gain 1 hour)
- `date-fns-tz` handles these transitions automatically

---

### Pure Functions for Testing

**Principle**: Keep business logic pure (no side effects) for easy testing

#### Examples of Pure Functions

**✅ Good** (Pure):
```typescript
function computeAttendanceStatusForStudent(
  classDays: ClassDay[],
  entries: Entry[]
): Record<string, AttendanceStatus> {
  // No database calls, no API calls, no mutations
  // Input → Output (deterministic)
}
```

**❌ Bad** (Impure):
```typescript
async function getAttendanceStatus(studentId: number) {
  // Database calls inside function
  const entries = await supabase.from('entries').select('*')
  // Hard to test, has side effects
}
```

#### Testing Strategy
1. **Core logic** (pure functions) → Unit tests with 100% coverage
2. **Data layer** (API routes) → Integration tests with mocked Supabase
3. **UI** (components) → Minimal tests, focus on interactions

---

### Security Architecture

#### Defense in Depth

**Layer 1: Input Validation**
- Validate all user input (email format, required fields)
- Sanitize content to prevent XSS
- Check data types match expected schema

**Layer 2: Authentication**
- Verify session exists and is valid
- Check session hasn't expired
- Verify HMAC signature on session cookie

**Layer 3: Authorization**
- Check user role (student vs teacher)
- Verify resource access (students can't access others' data)
- Use Row Level Security (RLS) in database

**Layer 4: Rate Limiting**
- Limit code requests (5 per hour per email)
- Limit verification attempts (3 per code)
- Prevent brute force attacks

**Layer 5: Database RLS**
- Final enforcement at database level
- Even if app logic fails, RLS prevents unauthorized access
- Policies checked on every query

---

## Middleware & Utilities

### Session Middleware

**Purpose**: Check authentication on protected routes

**Implementation**: `src/lib/auth.ts`
```typescript
export async function getSession(): Promise<Session | null> {
  // Read session cookie
  // Decrypt and verify
  // Return session data or null
}

export async function requireAuth(
  role?: 'student' | 'teacher'
): Promise<Session> {
  const session = await getSession()

  if (!session) {
    throw new Error('Unauthorized')
  }

  if (role && session.role !== role) {
    throw new Error('Forbidden')
  }

  return session
}
```

### Supabase Client

**Purpose**: Interact with database

**Implementation**: `src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)
```

**Note**: Use secret key for server-side operations, publishable key for client-side

---

## Deployment Architecture

### Vercel (Frontend & API)
- **Region**: Closest to users (auto-selected)
- **Edge Network**: Global CDN for static assets
- **Serverless Functions**: API routes run as lambdas
- **Environment**: Production and preview environments
- **CI/CD**: Automatic deployment on push to main

### Supabase (Database)
- **Region**: Choose closest to Vercel region
- **Connection**: Direct from Vercel serverless functions
- **Pooling**: Connection pooling enabled
- **Backups**: Automatic daily backups
- **Monitoring**: Built-in query performance monitoring

---

## Performance Considerations

### Server-Side Rendering (SSR)
- Student/teacher pages are server components
- Data fetched on server (faster, more secure)
- Initial HTML includes content (good for SEO)

### Caching Strategy
- Static assets cached by Vercel CDN
- API routes are dynamic (no caching)
- Database queries can be cached with React Server Components

### Database Optimization
- Indexes on frequently queried columns (student_id, date)
- RLS policies use indexes for fast filtering
- Connection pooling reduces latency

---

## Next Steps

- For UI/UX patterns, see [/docs/core/design.md](/docs/core/design.md)
- For testing strategy, see [/docs/core/tests.md](/docs/core/tests.md)
- For project setup, see [/docs/core/project-context.md](/docs/core/project-context.md)
- For agent collaboration, see [/docs/core/agents.md](/docs/core/agents.md)
