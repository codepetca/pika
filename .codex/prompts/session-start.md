Start a new AI session: validate environment, load context, identify next task.

Steps:
1) Confirm worktree: `git rev-parse --show-toplevel` — must contain `.codex/worktrees/` (or `.claude/worktrees/`).
   If it shows `$HOME/Repos/pika`, STOP — you are in the hub. Ask user to open session from a worktree.
2) Run: `bash scripts/verify-env.sh`
3) Recover context: `git log --oneline -10` and `cat .ai/SESSION-LOG.md`
4) Read docs: `docs/ai-instructions.md` then follow its reading order.
5) Check features: `node scripts/features.mjs next`
6) If $ARGUMENTS is an issue number: `gh issue view $ARGUMENTS --json number,title,body,labels`
7) State task clearly. Propose approach. Wait for approval before coding.
