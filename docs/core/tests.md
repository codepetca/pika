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

Test the `computeAttendanceStatusForStudent()` function:

- **No entries** → all class days marked `absent`
- **On-time entries** → marked `present`
- **Late entries** → marked `late`
- **Mixed scenarios** → correct status per day
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

Test code generation, hashing, and verification:

- `generateCode()` produces valid codes
- `hashCode()` uses bcrypt correctly
- `verifyCode()` validates against hash
- **Rate limiting** enforced (max attempts)
- **Expiry** handled correctly (10min window)

**TDD Flow**: Write tests for each function before implementation.

---

## 4. Data Layer Test Plan

**Location**: `tests/api/` (mirrors `src/app/api/`)

### 4.1 Authentication Routes

- `/api/auth/request-code`: code generation, hashing, rate limiting
- `/api/auth/verify-code`: validation, session creation, expiry

### 4.2 Student Routes

- `/api/student/entries`: CRUD operations for journal entries
- Timezone handling on `on_time` calculation

### 4.3 Teacher Routes

- `/api/teacher/attendance`: fetch attendance data
- CSV export functionality

**TDD Approach**: Mock Supabase client, test route logic in isolation.

---

## 5. Integration & Smoke Tests

**Location**: `tests/integration/`

Focus on **critical user flows**:

1. **Student flow**:
   - Login with email code
   - Submit journal entry
   - Verify attendance status updates

2. **Teacher flow**:
   - Login
   - View attendance dashboard
   - Export CSV

**Tools**: Consider Playwright for 1-2 E2E tests (optional).

---

## 6. Component Tests (Optional)

**Location**: `tests/components/`

Keep UI tests **minimal** and focused on critical interactions:

- Student daily form renders and submits
- Teacher dashboard displays attendance matrix
- Attendance icons (🟢🟡🔴) show correct status

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

