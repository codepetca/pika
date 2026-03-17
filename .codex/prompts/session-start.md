Start a new AI session: validate environment, load context, identify next task.

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Steps:
1) Verify environment: `echo $PIKA_WORKTREE` — must NOT be `$HOME/Repos/pika`.
   If unset/hub: STOP — tell user to run `pika codex <worktree>` first.
2) Run: `bash "$PIKA_WORKTREE/scripts/verify-env.sh"`
3) Recover context: `git -C "$PIKA_WORKTREE" log --oneline -10` and `tail -60 "$PIKA_WORKTREE/.ai/JOURNAL.md"`
4) Read docs: `$PIKA_WORKTREE/docs/ai-instructions.md` and `$PIKA_WORKTREE/docs/core/architecture.md`
5) Check features: `node "$PIKA_WORKTREE/scripts/features.mjs" next`
6) If $ARGUMENTS is an issue number: `gh issue view $ARGUMENTS --json number,title,body,labels`
7) State task clearly. Propose approach. Wait for approval before coding.

Alternatively, run the session start script:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-session-start/scripts/session_start.sh"
```
