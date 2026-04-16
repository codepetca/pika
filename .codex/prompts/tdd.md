Use TDD for the feature described in `$ARGUMENTS`.

If you have not already loaded it, read `docs/core/tests.md` first.

Steps:
1. Identify the target test file under `tests/lib/`, `tests/api/`, `tests/hooks/`, or `tests/components/`.
2. Write the failing test first.
3. Run `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>` and confirm it fails for the expected reason.
4. Implement the minimum code needed to pass.
5. Re-run the focused test, then refactor as needed.
6. Re-run the focused test and any nearby regression tests.
7. Check coverage when the change affects shared core logic.
