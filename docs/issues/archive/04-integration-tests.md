## Problem

There are currently no end-to-end (E2E) tests to verify critical user flows. While unit tests cover logic, E2E tests are needed to ensure the application works as a whole.

## Documentation Requirements

From `docs/core/tests.md`:
> "Integration & Smoke tests (critical user flows)"
> "Tools: Consider Playwright for 1-2 E2E tests (optional)."

## Required Tests

Create `tests/integration/` and implement the following flows using Playwright:

### 1. Student Flow
- Login with email code (mocked).
- Navigate to "Today" page.
- Submit a journal entry.
- Verify "On time" status appears.
- Verify entry appears in history.

### 2. Teacher Flow
- Login as teacher.
- Navigate to Dashboard.
- Verify attendance matrix loads.
- Click a student cell to view details.
- Export CSV (verify download trigger).

## Implementation Details

- Use **Playwright** for E2E testing.
- Mock authentication (bypass email code for tests).
- Use a seeded test database or mock API responses.

## Acceptance Criteria

- [ ] Playwright configured in project.
- [ ] Student critical flow test implemented.
- [ ] Teacher critical flow test implemented.
- [ ] Tests can run in CI/CD environment.

## Priority

**P2 - Medium** - Important for confidence, but lower priority than unit/API tests.
