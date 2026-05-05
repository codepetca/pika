Start a new AI session: validate environment, load context, identify next task.

This command implements the `.ai/START-HERE.md` ritual as an automated checklist.

Rules:
- Verify `$PIKA_WORKTREE` is set and is NOT `$HOME/Repos/pika`.
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`
- Stop and report clearly if any check fails.

Steps:

1) Verify worktree environment
   - Run: `echo $PIKA_WORKTREE`
   - If unset or equals `$HOME/Repos/pika`: STOP — tell me to run `pika claude <worktree>` first.
   - Run: `bash "$PIKA_WORKTREE/scripts/verify-env.sh"`
   - If verify-env.sh fails: STOP — report the failure.

2) Recover recent context
   - Run: `git -C "$PIKA_WORKTREE" log --oneline -10`
   - Run: `git -C "$PIKA_WORKTREE" status -sb`
   - Read `$PIKA_WORKTREE/.ai/CURRENT.md`.
   - Read `$PIKA_WORKTREE/.ai/SESSION-LOG.md` only if recent handoff context is needed.
   - Summarize: current branch, last few commits, uncommitted changes.

3) Load documentation
   - Read in order:
     1. `$PIKA_WORKTREE/.ai/START-HERE.md`
     2. `$PIKA_WORKTREE/.ai/features.json`
     3. `$PIKA_WORKTREE/docs/ai-instructions.md`
     4. Task-specific docs routed by `docs/ai-instructions.md`
   - Briefly confirm: current feature area being developed.

4) Check feature inventory
   - Run: `node "$PIKA_WORKTREE/scripts/features.mjs" summary`
   - Run: `node "$PIKA_WORKTREE/scripts/features.mjs" next`

5) Identify task
   - Priority: GitHub issue ($ARGUMENTS if given) → next failing feature → ask me.
   - If $ARGUMENTS has an issue number: `gh issue view $ARGUMENTS --json number,title,body,labels`
   - State the identified task clearly and propose an implementation approach.
   - Wait for my approval before writing any code.
