# Architecture & Design

High-level architectural patterns and UI/UX guidelines for **Pika**.

---

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

---

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

**On-time determination**: Entry is on-time if `updated_at` (converted to America/Toronto) is before midnight (start of next day) in Toronto time.

### 3. Route Protection

- Student routes: check `role = 'student'` and `student_id` matches session
- Teacher routes: check `role = 'teacher'`
- Implement middleware or layout-level auth checks

---

## Critical Implementation Details

### Timezone Handling

**ALWAYS use America/Toronto timezone** for deadline calculations. The `on_time` field must be computed by:
1. Converting `updated_at` from UTC to America/Toronto
2. Comparing against midnight (start of next day) in Toronto time

### Security Requirements

- **Hash all login codes** before storing (use bcrypt or similar)
- **Never store plaintext codes**
- Set HTTP-only, secure, SameSite cookies for sessions
- Validate email domain against `ALLOWED_EMAIL_DOMAIN` env var
- Rate limit code requests and verification attempts

### Pure Functions for Testing

Keep attendance logic pure and testable:
- `computeAttendanceStatusForStudent()` - no side effects
- `isOnTime(updatedAt: Date, date: string)` - timezone-aware comparison
- Write comprehensive unit tests for these functions

---

## UI/UX Guidelines

- **Mobile-first** design for student experience
- **Tailwind CSS** only - no component libraries
- **Simple icons**: 🟢 present, 🟡 late, 🔴 absent
- **Teacher dashboard**: Sticky left column (student names), scrollable dates
- Keep UI **minimal and functional** - avoid verbose subtitles or long instructional text
- Use short labels and sensible grouping
- Rely on spacing and headings for clarity
