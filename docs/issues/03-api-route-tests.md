## Problem

The project currently has **zero** API route tests. The testing strategy requires 90%+ coverage for the data layer to ensure business rules and database interactions are correct.

## Documentation Requirements

From `docs/core/tests.md`:
> "Data layer: 90%+ coverage"
> "TDD Approach: Mock Supabase client, test route logic in isolation."

## Missing Tests

We need to create a `tests/api/` directory and add tests for all API routes:

### Auth Routes
- [ ] `/api/auth/request-code`
- [ ] `/api/auth/verify-code`
- [ ] `/api/auth/me`

### Student Routes
- [ ] `/api/student/entries`
- [ ] `/api/student/classrooms`
- [ ] `/api/student/assignments`

### Teacher Routes
- [ ] `/api/teacher/attendance`
- [ ] `/api/teacher/class-days`
- [ ] `/api/teacher/classrooms`
- [ ] `/api/teacher/assignments`

## Implementation Strategy

1. **Setup Mocks**:
   - Create a reusable mock for the Supabase client.
   - Mock `next/headers` (cookies) for session handling.

2. **Test Scenarios**:
   - **Success**: Valid inputs return 200 OK and expected data.
   - **Auth Failure**: Unauthenticated requests return 401.
   - **Role Failure**: Student accessing teacher routes returns 403.
   - **Validation**: Invalid inputs return 400.
   - **Server Error**: Database errors return 500.

## Acceptance Criteria

- [ ] `tests/api/` directory created.
- [ ] Tests implemented for all major API routes.
- [ ] Supabase client is properly mocked (no real DB calls).
- [ ] Coverage for data layer > 90%.

## Priority

**P1 - High** - Critical for ensuring backend reliability.
