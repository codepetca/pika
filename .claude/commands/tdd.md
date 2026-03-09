Guide TDD implementation: write failing tests first, then implement to pass them.

Takes a feature description as $ARGUMENTS (e.g. `parseContentField utility`).

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- Tests MUST be written before implementation code.
- Prefer Vitest unit tests for pure functions; API route tests for route handlers.
- Verify `$PIKA_WORKTREE` is set before running any commands.

Steps:

1) Understand the feature scope
   - Parse $ARGUMENTS for feature name and type.
   - Identify: is this a pure utility, API route, hook, or component?
   - Read related existing code to understand patterns.

2) Identify test file location
   - Pure utilities: `tests/lib/<feature>.test.ts`
   - API routes: `tests/api/<area>/<feature>.test.ts`
   - Hooks: `tests/hooks/<feature>.test.ts`
   - Components: `tests/components/<feature>.test.tsx`

3) Write the test file FIRST
   - Import the function/module (it doesn't exist yet — that's fine).
   - Write test cases covering:
     - Happy path(s)
     - Edge cases (empty input, null, boundary values)
     - Error cases (invalid input, thrown errors)
   - Use `describe`/`it` blocks for organization.
   - Run tests to confirm they FAIL: `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>`

4) Write minimal implementation
   - Create the source file.
   - Write only enough code to pass the failing tests.
   - Do NOT add features not covered by tests.

5) Verify all tests pass
   - Run: `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>`
   - All tests should be green.

6) Refactor if needed
   - Improve readability without changing behavior.
   - Re-run tests to confirm still green.

7) Check coverage
   - Run: `pnpm -C "$PIKA_WORKTREE" test:coverage`
   - Core utilities should reach 100% coverage.
   - Report: lines covered, any uncovered branches.
