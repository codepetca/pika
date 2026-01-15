# Testing Strategy — TDD-First Approach

This file describes how we approach testing for **Pika** and which areas to cover. It is meant to **guide** test creation, not to be a perfect mirror of the code.

**Goals**:
- Focus testing where it matters most (business logic & data layer)
- Support a Test-Driven Development (TDD) workflow
- Avoid doc-code drift as the app evolves

---

## 1. Principles to Avoid Doc–Code Drift

**Test code is truth.** This doc describes *what to test*, not exact test cases.

Update this file when:
- Behavior or modules change meaningfully
- New core functionality is added
- Testing strategy shifts

Do NOT update for:
- Implementation details
- Minor refactors
- Individual test cases

---

## 2. Overall Testing Strategy

We use a **TDD-first approach** for core logic and a pragmatic approach for UI.

### Priority Order

1. **Core Utilities** (attendance, timezone, auth logic)
2. **Data Layer** (API routes, database interactions)
3. **Integration & Smoke tests** (critical user flows)
4. **Optional: Component tests** (UI snapshots, interaction tests)

### Why This Order?

- Core utilities are **pure functions** — easy to test, high value
- Data layer ensures **correctness** of business rules
- Integration tests catch **workflow issues**
- UI tests are **brittle** and should be minimal

---

## 3. Core Utilities Test Plan

**Location**: `tests/lib/` (mirrors `src/lib/`)

### 3.1 Attendance Logic (`src/lib/attendance.ts`)

Test the `computeAttendanceStatusForStudent()` function (present/absent only):

- **No entries** → all class days marked `absent`
- **On-time entries** → marked `present`
- **Mixed scenarios** → correct status per day
- **is_class_day=false** → skipped (remains absent)
- **Edge cases**: empty class days, empty entries

**TDD Flow**: Write these tests BEFORE implementing the function.

### 3.2 Timezone Handling (`src/lib/timezone.ts`)

Test the `isOnTime()` function:

- Entry **just before midnight** Toronto time → `true`
- Entry **just after midnight** Toronto time → `false`
- **DST transitions** handled correctly
- **UTC conversions** accurate

**TDD Flow**: Write tests first, then implement timezone logic.

### 3.3 Authentication (`src/lib/auth.ts`, `src/lib/crypto.ts`)

Test password-based flows:

- `generateVerificationCode()` length/charset
- `hashPassword`/`verifyPassword` bcrypt behavior
- `isTeacherEmail` domains and `DEV_TEACHER_EMAILS`
- Login lockout (5 attempts → 15 minute block)
- Session cookie options (secure/sameSite/httpOnly)
- `validatePassword` rules

**TDD Flow**: Write tests for each function before implementation.

---

## 4. Data Layer Test Plan

**Location**: `tests/api/` (mirrors `src/app/api/`)

### 4.1 Authentication Routes (primary)
- `/api/auth/signup` → stores verification code, respects per-hour limit
- `/api/auth/verify-signup` → attempts/expiry checks, role selection
- `/api/auth/create-password` → hashes password, creates session
- `/api/auth/login` → lockout after 5 failed attempts
- `/api/auth/forgot-password` → reset code issuance
- `/api/auth/reset-password/verify` + `/confirm` → code checks + password update
- Session cookie behavior (httpOnly, secure in prod, SameSite=Lax)

### 4.2 Student Routes
- `/api/student/classrooms` + `/join` + `/[id]` → enrollment checks, duplicate joins
- `/api/student/entries` → upsert per classroom/date, `on_time` in America/Toronto
- `/api/student/assignments` → status computation per assignment/doc

### 4.3 Teacher Routes
- `/api/teacher/classrooms` + `/[id]` + `/[id]/roster` → ownership + roster upload behavior
- `/api/teacher/class-days` → classroom scoping, holiday/weekend rules
- `/api/teacher/attendance` → aggregation matches `computeAttendanceRecords`
- `/api/teacher/export-csv` → correct headers/rows for selected classroom
- `/api/teacher/assignments` + `/[id]` → classroom scoping, stats (submitted/late)
- `/api/teacher/entry/[id]` → role-based access

### 4.4 Assignment Docs
- `/api/assignment-docs/[id]` → fetch/update only for owner student or classroom teacher
- `/submit` and `/unsubmit` → submitted_at handling, status transitions, late/on-time logic

### 5. Integration & Smoke Tests

**Location**: `tests/integration/` (or Playwright)

Focus on **critical user flows**:

1. **Student flow**:
   - Signup → verify email → create password → login
   - Join classroom via code
   - Submit journal entry
   - Open assignment, autosave content, submit, unsubmit
   - Verify attendance status updates

2. **Teacher flow**:
   - Login with password
   - View attendance dashboard
   - Upload roster CSV, see students appear
   - Create assignment and see student statuses update after submit/unsubmit
   - Export CSV

**Tools**: Consider Playwright for 1-2 E2E tests (optional).

### UI Snapshot Runs (Playwright)

For visual review (spacing/aesthetics), we also support a **manual** Playwright snapshot run against staging:
- Spec: `e2e/ui-snapshots.spec.ts`
- Output (local): `artifacts/ui-snapshots/` (screenshots) and `playwright-report/` (HTML report)
- Gallery (web): `/__ui` (gated by `ENABLE_UI_GALLERY=true`)

### AI-Assisted UI Testing (Playwright MCP)

For interactive UI verification during development, use the Playwright MCP server. This allows AI agents (Claude Code) to navigate and interact with the running application.

**Quick Start:**

```bash
# 1. Start the dev server (in one terminal)
pnpm dev

# 2. Generate auth states (if needed)
pnpm e2e:auth

# 3. Start MCP server as teacher or student
pnpm e2e:mcp --teacher
pnpm e2e:mcp --student
```

**Verification Scripts:**

Run predefined verification scenarios:

```bash
pnpm e2e:verify --help                    # List available scenarios
pnpm e2e:verify add-students-modal        # Verify add students modal
pnpm e2e:verify create-classroom-wizard   # Verify classroom creation
```

Scripts output JSON with pass/fail status and can be used to validate UI changes.

See `docs/guides/ai-ui-testing.md` for detailed usage patterns and MCP tool reference.

---

## 6. Component Tests (Optional)

**Location**: `tests/components/`

Keep UI tests **minimal** and focused on critical interactions:

- Student daily form renders and submits
- Teacher dashboard displays attendance matrix
- Attendance icons (🟢/🔴) show correct status
- Assignment editor autosave/save-state indicator works

**Philosophy**: Prefer testing business logic over UI. Keep views thin.

---

## 7. TDD Development Flow

For **new features**, follow this sequence:

1. **Models & Types** — Define TypeScript interfaces
2. **Core Utilities** (TDD):
   - Write unit tests for pure functions
   - Implement minimal code to pass tests
   - Refactor for clarity
3. **Data Layer** (TDD):
   - Write API route tests (mocked)
   - Implement routes
   - Refactor
4. **UI** (thin views):
   - Keep views minimal
   - Test through underlying logic
5. **Integration** (smoke tests):
   - 1-2 E2E tests for critical flows

### Example: Adding Attendance Feature

```
1. Define Entry, ClassDay, AttendanceStatus types
2. Write tests for computeAttendanceStatusForStudent() ← TDD
3. Implement the function
4. Write tests for /api/student/entries route ← TDD
5. Implement the route
6. Build thin UI (student form)
7. Add 1 E2E test (login → submit → verify)
```

---

## 8. Test Coverage Goals

- **Core utilities**: 100% coverage
- **Data layer**: 90%+ coverage
- **Integration**: Critical flows only
- **UI**: Focus on interactions, not snapshots

---

## 9. Running Tests

```bash
# Run all tests
npm run test

# Watch mode (for TDD)
npm run test:watch

# UI mode (interactive)
npm run test:ui

# Coverage report
npm run test:coverage
```

---

## 10. Maintenance Guidelines

When to update this file:

- **Adding a new core feature** → Add section describing what to test
- **Renaming/moving modules** → Update section headings
- **Changing testing strategy** → Update priority order or TDD flow

When NOT to update:

- Individual test cases
- Implementation details
- Minor refactors

**Remember**: This file is a **map**, not a strict checklist. Favor updating tests and code before updating this document.
