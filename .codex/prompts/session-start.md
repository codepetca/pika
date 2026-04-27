Start a new AI session.

Canonical startup rules live in `.ai/START-HERE.md`, `.ai/CURRENT.md`, `docs/ai-instructions.md`, and `docs/dev-workflow.md`.

Preferred path:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-session-start/scripts/session_start.sh"
```

Manual fallback:
1. Verify `$PIKA_WORKTREE` is set and is not `$HOME/Repos/pika`.
2. Run `bash "$PIKA_WORKTREE/scripts/verify-env.sh"`.
3. Review `git -C "$PIKA_WORKTREE" status -sb` and `git -C "$PIKA_WORKTREE" log --oneline -8`.
4. Read `.ai/START-HERE.md`, `.ai/CURRENT.md`, `.ai/features.json`, and `docs/ai-instructions.md`.
5. Load only the task-specific docs routed by `docs/ai-instructions.md`.
   - For UI work, include a UI guidance declaration.
   - Record: stable guidance followed
   - Record: experimental guidance introduced: yes/no
   - Record: human promotion needed: yes/no
   - For non-trivial work, declare risk profile: `none`, `workspace-state`, `async-grading`, `exam-mode`, or `runtime-platform`.
   - If any risk profile applies, read `docs/guidance/dev-flow-risk-checklists.md`.
6. If `$ARGUMENTS` is an issue number, run `gh issue view $ARGUMENTS --json number,title,body,labels`.
7. State the task, propose the approach, and wait for approval before coding.
