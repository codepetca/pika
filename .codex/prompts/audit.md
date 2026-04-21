Run the repo audit for changed files and report every violation found.

Preferred path:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-audit/scripts/audit.sh"
```

Focus on the full result set, not only the first failure. The audit checks the highest-drift patterns: manual API-route error handling, illegal `dark:` classes, duplicated `parseContentField`, `console.log`, and related violations.
