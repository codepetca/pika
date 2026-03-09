Guide TDD: write failing tests first, implement to pass, then refactor.

Takes a feature description as $ARGUMENTS.

Steps:
1) Understand feature scope from $ARGUMENTS
2) Identify test file: `tests/lib/`, `tests/api/`, `tests/hooks/`, or `tests/components/`
3) Write test file FIRST (function doesn't exist yet — that's expected)
4) Run to confirm tests FAIL: `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>`
5) Write minimal implementation to pass tests
6) Run again to confirm GREEN: `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>`
7) Refactor if needed, re-run to confirm still green
8) Check coverage: `pnpm -C "$PIKA_WORKTREE" test:coverage`
