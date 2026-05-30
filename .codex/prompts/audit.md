Run the repo audit for changed files and report every violation found.

Preferred path:
```bash
bash .codex/skills/pika-audit/scripts/audit.sh
```

Focus on the full result set, not only the first failure. The audit checks the highest-drift patterns: manual API-route error handling, illegal `dark:` classes, duplicated `parseContentField`, `console.log`, and related violations.

Also declare the task risk profile before reporting audit status:
- `none`
- `workspace-state`
- `async-grading`
- `exam-mode`
- `runtime-platform`

If a non-`none` risk profile applies, review `docs/guidance/dev-flow-risk-checklists.md` and report whether the relevant behavioral checks were covered by tests, visual verification, or explicit follow-up.

If changed UI files introduce or modify composite widget behavior, also review:
- `docs/guidance/ui/composite-widget-accessibility.md`

Report these explicitly when applicable:
- composite widget accessibility checklist reviewed: yes/no
- semantic/keyboard regression coverage added: yes/no
- focused tests changed for risky server or UI behavior: yes/no
- full validation pass completed: yes/no
