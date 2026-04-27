Use TDD for the feature described in `$ARGUMENTS`.

If you have not already loaded it, read `docs/core/tests.md` first.
If the task touches workspace state, async grading, exam mode, or runtime/platform behavior, also read `docs/guidance/dev-flow-risk-checklists.md` and name the risk profile before writing tests.

Steps:
1. Identify the target test file under `tests/lib/`, `tests/api/`, `tests/hooks/`, or `tests/components/`.
2. Write the failing test first.
3. Run `pnpm -C "$PIKA_WORKTREE" vitest run <test-file>` and confirm it fails for the expected reason.
4. Implement the minimum code needed to pass.
5. Re-run the focused test, then refactor as needed.
6. Re-run the focused test and any nearby regression tests.
7. Check coverage when the change affects shared core logic.
8. For workspace-state work, include a regression that the active editor/form/workspace stays mounted across non-destructive updates.
9. For async-grading work, include recovery/retry/partial-failure coverage.
10. For exam-mode work, include transient-loss, sustained-loss, restore, and draft-preservation coverage.
