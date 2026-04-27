Run the repo audit for changed files and report every violation found.

Preferred path:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-audit/scripts/audit.sh"
```

Focus on the full result set, not only the first failure. The audit checks the highest-drift patterns: manual API-route error handling, illegal `dark:` classes, duplicated `parseContentField`, `console.log`, and related violations.

Also declare the task risk profile before reporting audit status:
- `none`
- `workspace-state`
- `async-grading`
- `exam-mode`
- `runtime-platform`

If a non-`none` risk profile applies, review `docs/guidance/dev-flow-risk-checklists.md` and report whether the relevant behavioral checks were covered by tests, visual verification, or explicit follow-up.
