## Problem

The codebase currently lacks sufficient test coverage for core utilities, violating the project's testing strategy which requires 100% coverage for core logic.

## Documentation Requirements

From `docs/core/tests.md`:
> "Core utilities: 100% coverage"
> "TDD Flow: Write these tests BEFORE implementing the function."

## Missing Tests

The following files in `src/lib/` need corresponding test files in `tests/lib/`:

- [ ] `src/lib/auth.ts` -> `tests/lib/auth.test.ts`
- [ ] `src/lib/calendar.ts` -> `tests/lib/calendar.test.ts`
- [ ] `src/lib/email.ts` -> `tests/lib/email.test.ts`
- [ ] `src/lib/assignments.ts` -> `tests/lib/assignments.test.ts`

## Required Actions

1. **Create Directory Structure**:
   - Create `tests/lib/` directory to mirror `src/lib/`
   - Move existing unit tests (`tests/unit/*`) to `tests/lib/` if appropriate or keep as is but ensure coverage.

2. **Implement Tests**:
   - **Auth**: Test session creation, role checks, teacher email validation.
   - **Calendar**: Test class day generation, holiday exclusion.
   - **Email**: Test email sending logic (mocked).
   - **Assignments**: Test assignment status logic, due date calculations.

3. **Refactor Existing Tests**:
   - Ensure `attendance.test.ts`, `timezone.test.ts`, `crypto.test.ts` follow the TDD patterns described in `docs/core/tests.md`.

## Acceptance Criteria

- [ ] All files in `src/lib/` have a corresponding test file.
- [ ] Test coverage for core utilities reaches 100%.
- [ ] Tests pass locally.
- [ ] Tests follow the TDD philosophy (pure functions, no side effects).

## Priority

**P1 - High** - Required for MVP stability and to prevent regression.
