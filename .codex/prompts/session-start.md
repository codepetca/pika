Start a new AI session.

Canonical startup rules live in `.ai/START-HERE.md`, `.ai/CURRENT.md`, `docs/ai-instructions.md`, and `docs/dev-workflow.md`.

Preferred path:
```bash
bash .codex/skills/pika-session-start/scripts/session_start.sh
```

Manual fallback:
1. Resolve the repo root with `git rev-parse --show-toplevel` and verify it is not `$HOME/Repos/pika` for branch work.
2. Run `bash scripts/verify-env.sh`.
3. Review `git status -sb` and `git log --oneline -8`.
4. Read `.ai/START-HERE.md`, `.ai/CURRENT.md`, `.ai/features.json`, and `docs/ai-instructions.md`.
5. Read `.ai/SESSION-LOG.md` only if recent handoff context is needed; use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.
6. Load only the task-specific docs routed by `docs/ai-instructions.md`.
   - For UI work, include a UI guidance declaration.
   - Record: stable guidance followed
   - Record: experimental guidance introduced: yes/no
   - Record: human promotion needed: yes/no
   - For non-trivial work, declare risk profile: `none`, `workspace-state`, `async-grading`, `exam-mode`, or `runtime-platform`.
   - If any risk profile applies, read `docs/guidance/dev-flow-risk-checklists.md`.
7. If `$ARGUMENTS` is an issue number, run `gh issue view $ARGUMENTS --json number,title,body,labels`.
8. State the task, propose the approach, and wait for approval before coding.
