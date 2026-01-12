STOP and re-read the workflow docs before continuing.

You may have drifted from the required workflow. Follow these steps:

1) Check environment first: `echo $PIKA_WORKTREE`
2) Read the workflow docs:
   - Read `$PIKA_WORKTREE/.ai/START-HERE.md`
   - Read `$PIKA_WORKTREE/docs/dev-workflow.md`
   (If $PIKA_WORKTREE is unset, use `$HOME/Repos/pika`)

Key rules to remember:

- NEVER assume the shell cwd
- ALL git commands MUST use: `git -C "$PIKA_WORKTREE"`
- ALL file paths MUST be absolute or prefixed with `$PIKA_WORKTREE`
- Verify `$PIKA_WORKTREE` is set before running commands
- Hub (`$HOME/Repos/pika`) is for managing worktrees, NOT feature development

After reading, confirm:
1. What is `$PIKA_WORKTREE` set to?
2. What branch are you on?
3. What task are you working on?
